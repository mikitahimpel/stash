import { Context, Data, Effect, Layer, Redacted, Schema } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

// GitHub is the upstream identity: the OAuth flow ends with the GitHub login of whoever signed in.
// Requests go through `HttpClient`, so the entry provides the live fetch client and tests a fake.

export const authorizeUrl = "https://github.com/login/oauth/authorize";
export const accessTokenUrl = "https://github.com/login/oauth/access_token";
export const userUrl = "https://api.github.com/user";

export class GitHubIdentityError extends Data.TaggedError("GitHubIdentityError")<{
  readonly message: string;
}> {}

export interface Config {
  readonly clientId: string;
  readonly clientSecret: Redacted.Redacted<string>;
}

export interface SignIn {
  /** The GitHub `code` from the callback. */
  readonly code: string;
  /** The PKCE verifier whose S256 challenge was sent with the authorize redirect. */
  readonly codeVerifier: string;
  readonly redirectUri: string;
}

export class GitHubIdentity extends Context.Service<
  GitHubIdentity,
  {
    /** The URL that sends the browser to GitHub's consent screen. */
    readonly authorizeUrl: (options: {
      readonly state: string;
      readonly codeChallenge: string;
      readonly redirectUri: string;
    }) => string;
    /** Exchanges the callback `code` and returns the signed-in GitHub login. */
    readonly login: (signIn: SignIn) => Effect.Effect<string, GitHubIdentityError>;
  }
>()("@stash/mcp/GitHubIdentity") {}

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
      return GitHubIdentity.of({
        authorizeUrl: ({ state, codeChallenge, redirectUri }) => {
          const url = new URL(authorizeUrl);
          url.search = new URLSearchParams({
            client_id: config.clientId,
            redirect_uri: redirectUri,
            state,
            code_challenge: codeChallenge,
            code_challenge_method: "S256",
            allow_signup: "false",
          }).toString();
          return url.toString();
        },
        login: ({ code, codeVerifier, redirectUri }) =>
          Effect.gen(function* () {
            const token = yield* HttpClientRequest.post(accessTokenUrl).pipe(
              HttpClientRequest.acceptJson,
              HttpClientRequest.bodyUrlParams({
                client_id: config.clientId,
                client_secret: Redacted.value(config.clientSecret),
                code,
                code_verifier: codeVerifier,
                redirect_uri: redirectUri,
              }),
              client.execute,
              Effect.flatMap(HttpClientResponse.schemaBodyJson(AccessTokenResponse)),
              Effect.mapError(fail("GitHub code exchange failed")),
            );
            if (token.access_token === undefined) {
              return yield* new GitHubIdentityError({
                message: `GitHub code exchange failed: ${token.error ?? "no access token"}`,
              });
            }
            const user = yield* HttpClientRequest.get(userUrl).pipe(
              HttpClientRequest.bearerToken(token.access_token),
              HttpClientRequest.setHeader("accept", "application/vnd.github+json"),
              HttpClientRequest.setHeader("user-agent", "stash-mcp"),
              client.execute,
              Effect.flatMap(HttpClientResponse.schemaBodyJson(UserResponse)),
              Effect.mapError(fail("GitHub user lookup failed")),
            );
            return user.login;
          }),
      });
    }),
  );
