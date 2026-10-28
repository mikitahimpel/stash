import * as GithubConfig from "@stash/backend-platform/github-config";
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

// GitHub's OAuth Device Flow: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow
// It needs only the public client id, never a client secret. GitHub rejecting a token is
// `Unauthorized`. GitHub being unreachable or answering something unexpected is a defect (500):
// the endpoints declare no error for it.

export const deviceCodeEndpoint = "https://github.com/login/device/code";
export const accessTokenEndpoint = "https://github.com/login/oauth/access_token";
export const userEndpoint = "https://api.github.com/user";

export const deviceCodeGrantType = "urn:ietf:params:oauth:grant-type:device_code";

/** Enough to read the login, nothing more. */
export const scope = "read:user";

/** How long one call to GitHub may take. */
export const requestTimeout = Duration.seconds(10);

/** Seconds GitHub adds to the interval on every `slow_down`. */
export const slowDownSeconds = 5;

/** GitHub logins are case-insensitive. */
export const sameLogin = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** A started device flow. `deviceCode` must stay on the server. */
export interface DeviceCode {
  readonly deviceCode: Redacted.Redacted<string>;
  readonly userCode: string;
  readonly verificationUri: string;
  /** Seconds until the codes expire. */
  readonly expiresIn: number;
  /** Minimum seconds between two polls. */
  readonly interval: number;
}

/** GitHub's answer to one poll of the access token endpoint. */
export type PollResult =
  | { readonly _tag: "Pending" }
  /** Polled too fast. `interval` is the new minimum in seconds, when GitHub sends one. */
  | { readonly _tag: "SlowDown"; readonly interval: number | undefined }
  | { readonly _tag: "Expired" }
  | { readonly _tag: "Denied" }
  | { readonly _tag: "Authorized"; readonly accessToken: Redacted.Redacted<string> };

/** The GitHub side of the login: start a device flow, poll it, and look up the user. */
export class GithubClient extends Context.Service<
  GithubClient,
  {
    readonly requestDeviceCode: Effect.Effect<DeviceCode>;
    readonly pollAccessToken: (deviceCode: Redacted.Redacted<string>) => Effect.Effect<PollResult>;
    /** The login of the user the access token belongs to. */
    readonly fetchLogin: (
      accessToken: Redacted.Redacted<string>,
    ) => Effect.Effect<string, Errors.Unauthorized>;
  }
>()("@stash/backend-auth/GithubClient") {}

const NonEmpty = Schema.String.pipe(Schema.check(Schema.isNonEmpty()));
const Seconds = Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0)));

const DeviceCodeResponse = Schema.Struct({
  device_code: NonEmpty,
  user_code: NonEmpty,
  verification_uri: NonEmpty,
  expires_in: Seconds,
  interval: Seconds,
});

// GitHub answers 200 both with a token and with an `error` while the flow is not done.
const AccessTokenResponse = Schema.Union([
  Schema.Struct({ access_token: NonEmpty }),
  Schema.Struct({ error: Schema.String, interval: Schema.optional(Seconds) }),
]);

const User = Schema.Struct({ login: NonEmpty });

const unauthorized = (message: string) => new Errors.Unauthorized({ message });

export const make = Effect.gen(function* () {
  const config = yield* GithubConfig.GithubConfig;
  // GitHub's REST API rejects requests without a User-Agent, and Workers' fetch sends none.
  const client = (yield* HttpClient.HttpClient).pipe(
    HttpClient.mapRequest(HttpClientRequest.setHeader("user-agent", "stash")),
  );

  const call = <A, E>(effect: Effect.Effect<A, E>) =>
    effect.pipe(Effect.timeout(requestTimeout), Effect.orDie);

  /** POSTs a form to github.com and decodes the JSON answer. */
  const postForm = <A, I>(
    url: string,
    params: Record<string, string>,
    schema: Schema.Codec<A, I>,
  ): Effect.Effect<A> =>
    Effect.gen(function* () {
      const response = yield* call(
        client.execute(
          HttpClientRequest.post(url).pipe(
            HttpClientRequest.acceptJson,
            HttpClientRequest.bodyUrlParams(params),
          ),
        ),
      );
      if (response.status !== 200) {
        return yield* Effect.die(new Error(`GitHub answered ${response.status} to ${url}`));
      }
      return yield* call(HttpIncomingMessage.schemaBodyJson(schema)(response));
    });

  return GithubClient.of({
    requestDeviceCode: Effect.gen(function* () {
      const body = yield* postForm(
        deviceCodeEndpoint,
        { client_id: config.clientId, scope },
        DeviceCodeResponse,
      );
      return {
        deviceCode: Redacted.make(body.device_code),
        userCode: body.user_code,
        verificationUri: body.verification_uri,
        expiresIn: body.expires_in,
        interval: body.interval,
      };
    }).pipe(Effect.withSpan("GithubClient.requestDeviceCode")),
    pollAccessToken: Effect.fn("GithubClient.pollAccessToken")(function* (deviceCode) {
      const body = yield* postForm(
        accessTokenEndpoint,
        {
          client_id: config.clientId,
          device_code: Redacted.value(deviceCode),
          grant_type: deviceCodeGrantType,
        },
        AccessTokenResponse,
      );
      if ("access_token" in body) {
        return { _tag: "Authorized", accessToken: Redacted.make(body.access_token) } as const;
      }
      switch (body.error) {
        case "authorization_pending":
          return { _tag: "Pending" } as const;
        case "slow_down":
          return { _tag: "SlowDown", interval: body.interval } as const;
        // An unknown device code can only come from a flow GitHub already forgot.
        case "expired_token":
        case "incorrect_device_code":
          return { _tag: "Expired" } as const;
        case "access_denied":
          return { _tag: "Denied" } as const;
        // `incorrect_client_credentials`, `device_flow_disabled` and the like: a misconfigured app.
        default:
          return yield* Effect.die(new Error(`GitHub rejected the device flow: ${body.error}`));
      }
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
  HttpClient.HttpClient | GithubConfig.GithubConfig
> = Layer.effect(GithubClient)(make);
