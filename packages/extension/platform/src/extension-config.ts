import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import type { BrowserError } from "./browser-error.ts";
import * as Storage from "./browser-storage.ts";

/** How the extension reaches the API. Entered on the options page. */
export interface Config {
  /** The API origin, for example `https://stash.example.com`. */
  readonly apiBaseUrl: URL;
  /** The per-device API token, sent as `Authorization: Bearer <token>`. */
  readonly deviceToken: Redacted.Redacted<string>;
}

/** The stored form: plain strings, because `browser.storage` only holds JSON values. */
const Stored = Schema.Struct({
  apiBaseUrl: Schema.String.pipe(
    Schema.check(Schema.isPattern(/^https?:\/\//)),
    Schema.decodeTo(Schema.URLFromString),
  ),
  deviceToken: Schema.RedactedFromValue(
    Schema.String.pipe(Schema.check(Schema.isNonEmpty(), Schema.isTrimmed())),
  ),
});

/** The `browser.storage.local` key that holds the config. */
export const storageKey = "stash/config";

/**
 * Why there is no usable config:
 * - `Missing`: nothing was saved yet.
 * - `Invalid`: the stored value doesn't decode, for example a URL that is not http(s).
 */
export class ConfigError extends Data.TaggedError("ConfigError")<{
  readonly reason: "Missing" | "Invalid";
  readonly cause?: unknown;
}> {}

/**
 * The API base URL and device token, kept in extension storage.
 */
export class ExtensionConfig extends Context.Service<
  ExtensionConfig,
  {
    /** Reads the config on every call, so a change on the options page applies at once. */
    readonly get: Effect.Effect<Config, ConfigError | BrowserError>;
    /** Validates and saves the config. */
    readonly set: (config: {
      readonly apiBaseUrl: string;
      readonly deviceToken: Redacted.Redacted<string>;
    }) => Effect.Effect<void, ConfigError | BrowserError>;
    /** Forgets the config, for example when the token is revoked. */
    readonly clear: Effect.Effect<void, BrowserError>;
  }
>()("@stash/ext-platform/ExtensionConfig") {}

const decode = Schema.decodeUnknownEffect(Stored);

/** Built on `Storage`, so it is the same in the live and the test layers. */
export const layer: Layer.Layer<ExtensionConfig, never, Storage.Storage> = Layer.effect(
  ExtensionConfig,
)(
  Effect.gen(function* () {
    const storage = yield* Storage.Storage;
    return {
      get: Effect.flatMap(storage.get(storageKey), (stored) =>
        Option.match(stored, {
          onNone: () => Effect.fail(new ConfigError({ reason: "Missing" })),
          onSome: (value) =>
            decode(value).pipe(
              Effect.mapError((cause) => new ConfigError({ reason: "Invalid", cause })),
            ),
        }),
      ),
      set: (config) => {
        const stored = {
          apiBaseUrl: config.apiBaseUrl.trim(),
          deviceToken: Redacted.value(config.deviceToken).trim(),
        };
        return decode(stored).pipe(
          Effect.mapError((cause) => new ConfigError({ reason: "Invalid", cause })),
          Effect.andThen(storage.set(storageKey, stored)),
        );
      },
      clear: storage.remove(storageKey),
    };
  }),
);
