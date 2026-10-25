import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

/** Personal and tunable values. They come from Worker vars, never from source. */
export class StashConfig extends Context.Service<
  StashConfig,
  {
    /** The one GitHub login allowed to sign in to the web app and MCP. */
    readonly allowedGithubLogin: string;
    /** The web app's origin, for CORS and OAuth redirects, e.g. `https://stash.example.com`. */
    readonly webOrigin: string;
    /** Open Zen tabs older than this are archived (and closed) by the cron. */
    readonly archiveAfterDays: number;
  }
>()("@stash/backend-platform/StashConfig") {}

export const defaultArchiveAfterDays = 30;

export class StashConfigError extends Data.TaggedError("StashConfigError")<{
  readonly cause: unknown;
}> {}

const NonEmpty = Schema.String.pipe(Schema.check(Schema.isNonEmpty()));

const Origin = NonEmpty.pipe(
  Schema.check(
    Schema.makeFilter((value: string) => URL.canParse(value) && new URL(value).origin === value, {
      expected: "an origin such as https://example.com (scheme and host, no path)",
    }),
  ),
);

const PositiveIntFromString = Schema.NumberFromString.pipe(
  Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
);

/** The Worker vars this config reads. */
export const Env = Schema.Struct({
  ALLOWED_GITHUB_LOGIN: NonEmpty,
  WEB_ORIGIN: Origin,
  ARCHIVE_AFTER_DAYS: Schema.optional(PositiveIntFromString),
});
export type Env = typeof Env.Encoded;

/** Reads and validates the config from the Worker `env`. */
export const fromEnv = (env: unknown): Effect.Effect<StashConfig["Service"], StashConfigError> =>
  Schema.decodeUnknownEffect(Env)(env).pipe(
    Effect.map((vars) => ({
      allowedGithubLogin: vars.ALLOWED_GITHUB_LOGIN,
      webOrigin: vars.WEB_ORIGIN,
      archiveAfterDays: vars.ARCHIVE_AFTER_DAYS ?? defaultArchiveAfterDays,
    })),
    Effect.mapError((cause) => new StashConfigError({ cause })),
  );

export const layerFromEnv = (env: unknown): Layer.Layer<StashConfig, StashConfigError> =>
  Layer.effect(StashConfig)(fromEnv(env));
