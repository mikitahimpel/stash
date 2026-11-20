import * as GoogleConfig from "@stash/backend-platform/google-config";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Base64Url from "effect/encoding/Base64Url";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpIncomingMessage from "effect/http/HttpIncomingMessage";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

// Google's side of Sign in with Google: an OpenID Connect authorization code flow with PKCE
// (https://developers.google.com/identity/openid-connect/openid-connect). The code is exchanged
// with the client secret, and the ID token that comes back is verified before anything trusts it:
// its RS256 signature against Google's published keys, the issuer, the audience (this client), the
// expiry and the nonce of this sign-in. Only `sub` identifies the account; the e-mail is a label.
// Nothing Google returns is stored but those two, and no token is logged.

/** How long one call to Google may take. */
export const requestTimeout = Duration.seconds(10);

/** Seconds of clock difference tolerated on `exp` and `iat`. */
export const clockSkewSeconds = 60;

/** The account an ID token names. */
export interface GoogleAccount {
  /** Google's stable id of the account. */
  readonly sub: string;
  /** Shown as the account's label only. */
  readonly email: string | null;
}

/** Google refused, or answered something that does not verify. Never carries a token. */
export class GoogleError extends Data.TaggedError("GoogleError")<{
  readonly reason: string;
}> {}

export class GoogleClient extends Context.Service<
  GoogleClient,
  {
    /** The ID token for an authorization code. */
    readonly exchangeCode: (options: {
      readonly code: string;
      readonly verifier: Redacted.Redacted<string>;
      readonly redirectUri: string;
    }) => Effect.Effect<Redacted.Redacted<string>, GoogleError>;
    /** The account of a verified ID token issued for this client and this sign-in's nonce. */
    readonly verifyIdToken: (
      idToken: Redacted.Redacted<string>,
      nonce: string,
    ) => Effect.Effect<GoogleAccount, GoogleError>;
  }
>()("@stash/backend-auth/GoogleClient") {}

const fail = (reason: string) => new GoogleError({ reason });

const TokenResponse = Schema.Struct({ id_token: Schema.String });

const Jwk = Schema.Struct({
  kid: Schema.String,
  kty: Schema.Literal("RSA"),
  n: Schema.String,
  e: Schema.String,
  alg: Schema.optional(Schema.String),
});
const Jwks = Schema.Struct({ keys: Schema.Array(Schema.Unknown) });
type Jwk = typeof Jwk.Type;

const Header = Schema.Struct({ alg: Schema.String, kid: Schema.String });

const Audience = Schema.Union([Schema.String, Schema.Array(Schema.String)]);
const Claims = Schema.Struct({
  iss: Schema.String,
  aud: Audience,
  azp: Schema.optional(Schema.String),
  sub: Schema.String.pipe(Schema.check(Schema.isNonEmpty(), Schema.isMaxLength(255))),
  exp: Schema.Number,
  iat: Schema.Number,
  nonce: Schema.optional(Schema.String),
  email: Schema.optional(Schema.String),
  email_verified: Schema.optional(Schema.Union([Schema.Boolean, Schema.String])),
});

const decodeJsonPart = <A>(schema: Schema.Codec<A, unknown>, part: string) => {
  const bytes = Base64Url.decode(part);
  if (Result.isFailure(bytes)) return Effect.fail(fail("malformed ID token"));
  return Effect.try({
    try: () => JSON.parse(new TextDecoder().decode(bytes.success)) as unknown,
    catch: () => fail("malformed ID token"),
  }).pipe(
    Effect.flatMap((json) => Schema.decodeUnknownEffect(schema)(json)),
    Effect.mapError(() => fail("malformed ID token")),
  );
};

/** Whether two strings are equal, in time that does not depend on where they differ. */
const constantTimeEqual = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

export const make = Effect.gen(function* () {
  const config = yield* GoogleConfig.GoogleConfig;
  const client = yield* HttpClient.HttpClient;
  const call = <A, E>(effect: Effect.Effect<A, E>) =>
    effect.pipe(
      Effect.timeout(requestTimeout),
      Effect.mapError(() => fail("Google could not be reached")),
    );

  // The signing keys, by `kid`, for this isolate. A token signed with an unknown key fetches them
  // again (Google rotates them), at most once a minute.
  let keys = new Map<string, CryptoKey>();
  let fetchedAt = Number.NEGATIVE_INFINITY;

  const fetchKeys = (jwksUri: string) =>
    Effect.gen(function* () {
      const response = yield* call(client.execute(HttpClientRequest.get(jwksUri)));
      if (response.status !== 200) return yield* fail(`Google keys answered ${response.status}`);
      const body = yield* call(HttpIncomingMessage.schemaBodyJson(Jwks)(response));
      const next = new Map<string, CryptoKey>();
      for (const candidate of body.keys) {
        const jwk = Schema.decodeUnknownOption(Jwk)(candidate);
        if (jwk._tag === "None") continue;
        const key = yield* importKey(jwk.value);
        if (key !== undefined) next.set(jwk.value.kid, key);
      }
      keys = next;
      fetchedAt = yield* Clock.currentTimeMillis;
    });

  const importKey = (jwk: Jwk) =>
    Effect.promise(() =>
      crypto.subtle
        .importKey(
          "jwk",
          { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
          { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
          false,
          ["verify"],
        )
        .catch(() => undefined),
    );

  const keyFor = (kid: string, jwksUri: string) =>
    Effect.gen(function* () {
      const known = keys.get(kid);
      if (known !== undefined) return known;
      if ((yield* Clock.currentTimeMillis) - fetchedAt > 60_000) yield* fetchKeys(jwksUri);
      const fetched = keys.get(kid);
      if (fetched === undefined) return yield* fail("ID token signed with an unknown key");
      return fetched;
    });

  if (!config.configured) {
    const off = Effect.fail(fail("Google sign-in is not configured"));
    return GoogleClient.of({ exchangeCode: () => off, verifyIdToken: () => off });
  }
  const { clientId, clientSecret, endpoints } = config;
  const issuers = [
    endpoints.issuer,
    ...(endpoints === GoogleConfig.googleEndpoints ? GoogleConfig.googleIssuerAliases : []),
  ];

  return GoogleClient.of({
    exchangeCode: Effect.fn("GoogleClient.exchangeCode")(function* (options) {
      const response = yield* call(
        client.execute(
          HttpClientRequest.post(endpoints.token).pipe(
            HttpClientRequest.acceptJson,
            HttpClientRequest.bodyUrlParams({
              grant_type: "authorization_code",
              code: options.code,
              client_id: clientId,
              client_secret: Redacted.value(clientSecret),
              redirect_uri: options.redirectUri,
              code_verifier: Redacted.value(options.verifier),
            }),
          ),
        ),
      );
      if (response.status !== 200)
        return yield* fail(`Google token endpoint answered ${response.status}`);
      const body = yield* call(HttpIncomingMessage.schemaBodyJson(TokenResponse)(response));
      return Redacted.make(body.id_token);
    }),
    verifyIdToken: Effect.fn("GoogleClient.verifyIdToken")(function* (idToken, nonce) {
      const parts = Redacted.value(idToken).split(".");
      if (parts.length !== 3) return yield* fail("malformed ID token");
      const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];
      const header = yield* decodeJsonPart(Header, headerPart);
      if (header.alg !== "RS256") return yield* fail("ID token is not RS256");
      const key = yield* keyFor(header.kid, endpoints.jwks);
      const signature = Base64Url.decode(signaturePart);
      if (Result.isFailure(signature)) return yield* fail("malformed ID token");
      const valid = yield* Effect.promise(() =>
        crypto.subtle
          .verify(
            "RSASSA-PKCS1-v1_5",
            key,
            signature.success as Uint8Array<ArrayBuffer>,
            new TextEncoder().encode(`${headerPart}.${payloadPart}`),
          )
          .catch(() => false),
      );
      if (!valid) return yield* fail("ID token signature does not verify");

      const claims = yield* decodeJsonPart(Claims, payloadPart);
      const now = (yield* Clock.currentTimeMillis) / 1000;
      if (!issuers.includes(claims.iss)) return yield* fail("ID token from another issuer");
      const audience = typeof claims.aud === "string" ? [claims.aud] : claims.aud;
      if (!audience.includes(clientId)) return yield* fail("ID token for another client");
      if (audience.length > 1 && claims.azp !== clientId) {
        return yield* fail("ID token for another client");
      }
      if (claims.exp + clockSkewSeconds < now) return yield* fail("ID token expired");
      if (claims.iat - clockSkewSeconds > now) return yield* fail("ID token from the future");
      if (claims.nonce === undefined || !constantTimeEqual(claims.nonce, nonce)) {
        return yield* fail("ID token for another sign-in");
      }
      const verified = claims.email_verified === true || claims.email_verified === "true";
      return {
        sub: claims.sub,
        email: claims.email !== undefined && verified ? claims.email.slice(0, 254) : null,
      };
    }),
  });
});

/** The client over the platform `HttpClient`. */
export const layer: Layer.Layer<
  GoogleClient,
  never,
  HttpClient.HttpClient | GoogleConfig.GoogleConfig
> = Layer.effect(GoogleClient)(make);
