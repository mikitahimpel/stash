import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

/** The GitHub OAuth app's credentials. They come from Worker secrets, never from source. */
export class GithubOAuthConfig extends Context.Service<
  GithubOAuthConfig,
  {
    readonly clientId: string;
    readonly clientSecret: Redacted.Redacted<string>;
  }
>()("@stash/backend-platform/GithubOAuthConfig") {}

export class GithubOAuthConfigError extends Data.TaggedError("GithubOAuthConfigError")<{
  readonly cause: unknown;
}> {}

const NonEmpty = Schema.String.pipe(Schema.check(Schema.isNonEmpty()));

/** The Worker vars and secrets this config reads. */
export const Env = Schema.Struct({
  GITHUB_OAUTH_CLIENT_ID: NonEmpty,
  GITHUB_OAUTH_CLIENT_SECRET: NonEmpty,
});
export type Env = typeof Env.Encoded;

/** Reads and validates the credentials from the Worker `env`. The error never holds the secret. */
export const fromEnv = (
  env: unknown,
): Effect.Effect<GithubOAuthConfig["Service"], GithubOAuthConfigError> =>
  Schema.decodeUnknownEffect(Env)(env).pipe(
    Effect.map((vars) => ({
      clientId: vars.GITHUB_OAUTH_CLIENT_ID,
      clientSecret: Redacted.make(vars.GITHUB_OAUTH_CLIENT_SECRET),
    })),
    // A schema issue may quote the offending value, so only the shape of the problem is kept.
    Effect.mapError(
      () =>
        new GithubOAuthConfigError({
          cause: "GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET must be non-empty strings",
        }),
    ),
  );

export const layerFromEnv = (
  env: unknown,
): Layer.Layer<GithubOAuthConfig, GithubOAuthConfigError> =>
  Layer.effect(GithubOAuthConfig)(fromEnv(env));
