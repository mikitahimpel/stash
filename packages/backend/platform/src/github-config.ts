import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

/**
 * The GitHub OAuth app the login runs against. The Device Flow needs no client secret, and the
 * client id is public: it comes from a plain Worker var, never from source.
 */
export class GithubConfig extends Context.Service<
  GithubConfig,
  {
    readonly clientId: string;
  }
>()("@stash/backend-platform/GithubConfig") {}

export class GithubConfigError extends Data.TaggedError("GithubConfigError")<{
  readonly cause: unknown;
}> {}

const NonEmpty = Schema.String.pipe(Schema.check(Schema.isNonEmpty()));

/** The Worker vars this config reads. */
export const Env = Schema.Struct({
  GITHUB_CLIENT_ID: NonEmpty,
});
export type Env = typeof Env.Encoded;

/** Reads and validates the config from the Worker `env`. */
export const fromEnv = (env: unknown): Effect.Effect<GithubConfig["Service"], GithubConfigError> =>
  Schema.decodeUnknownEffect(Env)(env).pipe(
    Effect.map((vars) => ({ clientId: vars.GITHUB_CLIENT_ID })),
    Effect.mapError((cause) => new GithubConfigError({ cause })),
  );

export const layerFromEnv = (env: unknown): Layer.Layer<GithubConfig, GithubConfigError> =>
  Layer.effect(GithubConfig)(fromEnv(env));
