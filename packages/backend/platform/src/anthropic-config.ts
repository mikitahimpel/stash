import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

/** The Anthropic API key for the link classifier. It comes from a Worker secret, never from source. */
export class AnthropicConfig extends Context.Service<
  AnthropicConfig,
  { readonly apiKey: Redacted.Redacted<string> }
>()("@stash/backend-platform/AnthropicConfig") {}

export class AnthropicConfigError extends Data.TaggedError("AnthropicConfigError")<{
  readonly cause: unknown;
}> {}

/** The Worker secret this config reads. */
export const Env = Schema.Struct({
  ANTHROPIC_API_KEY: Schema.String.pipe(Schema.check(Schema.isNonEmpty())),
});
export type Env = typeof Env.Encoded;

/** Reads and validates the key from the Worker `env`. The error never holds the key. */
export const fromEnv = (
  env: unknown,
): Effect.Effect<AnthropicConfig["Service"], AnthropicConfigError> =>
  Schema.decodeUnknownEffect(Env)(env).pipe(
    Effect.map((vars) => ({ apiKey: Redacted.make(vars.ANTHROPIC_API_KEY) })),
    // A schema issue may quote the offending value, so only the shape of the problem is kept.
    Effect.mapError(
      () => new AnthropicConfigError({ cause: "ANTHROPIC_API_KEY must be a non-empty string" }),
    ),
  );

export const layerFromEnv = (env: unknown): Layer.Layer<AnthropicConfig, AnthropicConfigError> =>
  Layer.effect(AnthropicConfig)(fromEnv(env));
