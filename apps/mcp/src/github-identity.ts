import { Context, Data, Effect, Layer, Schema } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

// GitHub is the upstream identity, reached with the OAuth Device Flow: no client secret, no
// redirect back to this Worker. The flow ends with the GitHub login of whoever entered the code.
// The GitHub access token is used once to read that login and then dropped, never stored.
// Requests go through `HttpClient`, so the entry provides the live fetch client and tests a fake.

export const deviceCodeUrl = "https://github.com/login/device/code";
export const accessTokenUrl = "https://github.com/login/oauth/access_token";
export const userUrl = "https://api.github.com/user";

const deviceCodeGrant = "urn:ietf:params:oauth:grant-type:device_code";

export class GitHubIdentityError extends Data.TaggedError("GitHubIdentityError")<{
  readonly message: string;
}> {}

export interface Config {
  /** The GitHub OAuth App's client ID. Public: device flow needs no secret. */
  readonly clientId: string;
}

/** A started device flow. `deviceCode` stays on the server; the user enters `userCode`. */
export interface DeviceFlow {
  readonly deviceCode: string;
  readonly userCode: string;
  readonly verificationUri: string;
  /** Seconds until GitHub expires the codes. */
  readonly expiresIn: number;
  /** Seconds GitHub wants between polls. */
  readonly interval: number;
}

/** One poll of the token endpoint. `SlowDown` means: add 5 seconds to the interval. */
export type Poll =
  | { readonly _tag: "Pending" }
  | { readonly _tag: "SlowDown" }
  | { readonly _tag: "Expired" }
  | { readonly _tag: "Denied" }
  | { readonly _tag: "SignedIn"; readonly login: string };

export class GitHubIdentity extends Context.Service<
  GitHubIdentity,
  {
    /** Asks GitHub for a device and user code (scope `read:user`). */
    readonly start: Effect.Effect<DeviceFlow, GitHubIdentityError>;
    /** Polls once for the token; on success reads the login and drops the token. */
    readonly poll: (deviceCode: string) => Effect.Effect<Poll, GitHubIdentityError>;
  }
>()("@stash/mcp/GitHubIdentity") {}

const DeviceCodeResponse = Schema.Struct({
  device_code: Schema.String,
  user_code: Schema.String,
  verification_uri: Schema.String,
  expires_in: Schema.Number,
  interval: Schema.Number,
});

const AccessTokenResponse = Schema.Struct({
  access_token: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
});

const UserResponse = Schema.Struct({ login: Schema.String });

const fail = (message: string) => () => new GitHubIdentityError({ message });

export const layer = (config: Config): Layer.Layer<GitHubIdentity, never, HttpClient.HttpClient> =>
  Layer.effect(GitHubIdentity)(
    Effect.gen(function* () {
      const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);

      const readLogin = (accessToken: string) =>
        HttpClientRequest.get(userUrl).pipe(
          HttpClientRequest.bearerToken(accessToken),
          HttpClientRequest.setHeader("accept", "application/vnd.github+json"),
          HttpClientRequest.setHeader("user-agent", "stash-mcp"),
          client.execute,
          Effect.flatMap(HttpClientResponse.schemaBodyJson(UserResponse)),
          Effect.map((user) => user.login),
          Effect.mapError(fail("GitHub user lookup failed")),
        );

      return GitHubIdentity.of({
        start: HttpClientRequest.post(deviceCodeUrl).pipe(
          HttpClientRequest.acceptJson,
          HttpClientRequest.bodyUrlParams({ client_id: config.clientId, scope: "read:user" }),
          client.execute,
          Effect.flatMap(HttpClientResponse.schemaBodyJson(DeviceCodeResponse)),
          Effect.map((body): DeviceFlow => ({
            deviceCode: body.device_code,
            userCode: body.user_code,
            verificationUri: body.verification_uri,
            expiresIn: body.expires_in,
            interval: body.interval,
          })),
          Effect.mapError(fail("GitHub device flow could not start")),
        ),
        poll: (deviceCode) =>
          Effect.gen(function* () {
            const token = yield* HttpClientRequest.post(accessTokenUrl).pipe(
              HttpClientRequest.acceptJson,
              HttpClientRequest.bodyUrlParams({
                client_id: config.clientId,
                device_code: deviceCode,
                grant_type: deviceCodeGrant,
              }),
              client.execute,
              Effect.flatMap(HttpClientResponse.schemaBodyJson(AccessTokenResponse)),
              Effect.mapError(fail("GitHub token poll failed")),
            );
            if (token.access_token !== undefined) {
              return { _tag: "SignedIn", login: yield* readLogin(token.access_token) } as const;
            }
            switch (token.error) {
              case "authorization_pending":
                return { _tag: "Pending" } as const;
              case "slow_down":
                return { _tag: "SlowDown" } as const;
              case "expired_token":
                return { _tag: "Expired" } as const;
              case "access_denied":
                return { _tag: "Denied" } as const;
              default:
                return yield* new GitHubIdentityError({
                  message: `GitHub token poll failed: ${token.error ?? "no access token"}`,
                });
            }
          }),
      });
    }),
  );
