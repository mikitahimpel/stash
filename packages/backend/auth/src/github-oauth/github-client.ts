import * as GithubOAuthConfig from "@stash/backend-platform/github-oauth-config";
import * as Errors from "@stash/contracts-domain/errors";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpIncomingMessage from "effect/http/HttpIncomingMessage";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

// GitHub's OAuth web flow: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps
// GitHub rejecting a code or token is `Unauthorized`. GitHub being unreachable or answering
// something unexpected is a defect (500): the endpoints declare no error for it.

export const authorizeEndpoint = "https://github.com/login/oauth/authorize";
export const accessTokenEndpoint = "https://github.com/login/oauth/access_token";
export const userEndpoint = "https://api.github.com/user";

/** How long one call to GitHub may take. */
export const requestTimeout = Duration.seconds(10);

/** GitHub logins are case-insensitive. */
export const sameLogin = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** The GitHub side of the login: the authorize redirect, the code exchange and the user lookup. */
export class GithubClient extends Context.Service<
  GithubClient,
  {
    /** Where to send the browser to sign in. */
    readonly authorizeUrl: (options: {
      readonly state: string;
      readonly redirectUri: string;
    }) => string;
    /** Trades the callback's `code` for an access token. */
    readonly exchangeCode: (options: {
      readonly code: string;
      readonly redirectUri: string;
    }) => Effect.Effect<Redacted.Redacted<string>, Errors.Unauthorized>;
    /** The login of the user the access token belongs to. */
    readonly fetchLogin: (
      accessToken: Redacted.Redacted<string>,
    ) => Effect.Effect<string, Errors.Unauthorized>;
  }
>()("@stash/backend-auth/GithubClient") {}

// On a bad code GitHub answers 200 with an `error` field instead of a token.
const AccessTokenResponse = Schema.Union([
  Schema.Struct({ access_token: Schema.String.pipe(Schema.check(Schema.isNonEmpty())) }),
  Schema.Struct({ error: Schema.String }),
]);

const User = Schema.Struct({ login: Schema.String.pipe(Schema.check(Schema.isNonEmpty())) });

const unauthorized = (message: string) => new Errors.Unauthorized({ message });

export const make = Effect.gen(function* () {
  const config = yield* GithubOAuthConfig.GithubOAuthConfig;
  // GitHub's REST API rejects requests without a User-Agent, and Workers' fetch sends none.
  const client = (yield* HttpClient.HttpClient).pipe(
    HttpClient.mapRequest(HttpClientRequest.setHeader("user-agent", "stash")),
  );

  const call = <A, E>(effect: Effect.Effect<A, E>) =>
    effect.pipe(Effect.timeout(requestTimeout), Effect.orDie);

  return GithubClient.of({
    authorizeUrl: ({ state, redirectUri }) => {
      const url = new URL(authorizeEndpoint);
      url.searchParams.set("client_id", config.clientId);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("state", state);
      url.searchParams.set("allow_signup", "false");
      return url.toString();
    },
    exchangeCode: Effect.fn("GithubClient.exchangeCode")(function* ({ code, redirectUri }) {
      const response = yield* call(
        client.execute(
          HttpClientRequest.post(accessTokenEndpoint).pipe(
            HttpClientRequest.acceptJson,
            HttpClientRequest.bodyUrlParams({
              client_id: config.clientId,
              client_secret: Redacted.value(config.clientSecret),
              code,
              redirect_uri: redirectUri,
            }),
          ),
        ),
      );
      if (response.status >= 400 && response.status < 500) {
        return yield* unauthorized("GitHub rejected the code");
      }
      if (response.status !== 200) {
        return yield* Effect.die(
          new Error(`GitHub answered ${response.status} to the code exchange`),
        );
      }
      const body = yield* call(HttpIncomingMessage.schemaBodyJson(AccessTokenResponse)(response));
      if ("error" in body) return yield* unauthorized("GitHub rejected the code");
      return Redacted.make(body.access_token);
    }),
    fetchLogin: Effect.fn("GithubClient.fetchLogin")(function* (accessToken) {
      const response = yield* call(
        client.execute(
          HttpClientRequest.get(userEndpoint).pipe(
            HttpClientRequest.accept("application/vnd.github+json"),
            HttpClientRequest.bearerToken(Redacted.value(accessToken)),
          ),
        ),
      );
      if (response.status === 401 || response.status === 403) {
        return yield* unauthorized("GitHub rejected the access token");
      }
      if (response.status !== 200) {
        return yield* Effect.die(
          new Error(`GitHub answered ${response.status} to the user lookup`),
        );
      }
      const user = yield* call(HttpIncomingMessage.schemaBodyJson(User)(response));
      return user.login;
    }),
  });
});

/** The client over the platform `HttpClient`. */
export const layer: Layer.Layer<
  GithubClient,
  never,
  HttpClient.HttpClient | GithubOAuthConfig.GithubOAuthConfig
> = Layer.effect(GithubClient)(make);
