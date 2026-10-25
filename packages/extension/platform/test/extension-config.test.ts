import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Storage from "../src/browser-storage.ts";
import * as ExtensionConfig from "../src/extension-config.ts";
import * as Testing from "../src/testing.ts";

// Synthetic placeholder, not a real token.
const deviceToken = "synthetic-device-token";

const run = <A, E>(
  effect: Effect.Effect<A, E, ExtensionConfig.ExtensionConfig | Storage.Storage>,
  initial: Record<string, unknown> = {},
) =>
  effect.pipe(
    Effect.provide(
      ExtensionConfig.layer.pipe(Layer.provideMerge(Testing.layerStorage({ initial }))),
    ),
  );

describe("ExtensionConfig", () => {
  it.effect("fails with Missing before anything is saved", () =>
    run(
      Effect.gen(function* () {
        const error = yield* Effect.flip((yield* ExtensionConfig.ExtensionConfig).get);
        expect(error).toMatchObject({ _tag: "ConfigError", reason: "Missing" });
      }),
    ),
  );

  it.effect("saves trimmed values and reads them back", () =>
    run(
      Effect.gen(function* () {
        const config = yield* ExtensionConfig.ExtensionConfig;
        yield* config.set({
          apiBaseUrl: " https://api.example.com ",
          deviceToken: Redacted.make(` ${deviceToken} `),
        });
        const saved = yield* config.get;
        expect(saved.apiBaseUrl.href).toBe("https://api.example.com/");
        expect(Redacted.value(saved.deviceToken)).toBe(deviceToken);
        expect(String(saved.deviceToken)).not.toContain(deviceToken);

        const stored = yield* (yield* Storage.Storage).get(ExtensionConfig.storageKey);
        expect(stored).toEqual(Option.some({ apiBaseUrl: "https://api.example.com", deviceToken }));

        yield* config.clear;
        expect(yield* Effect.flip(config.get)).toMatchObject({ reason: "Missing" });
      }),
    ),
  );

  it.effect("rejects invalid values without saving them", () =>
    run(
      Effect.gen(function* () {
        const config = yield* ExtensionConfig.ExtensionConfig;
        for (const apiBaseUrl of ["ftp://api.example.com", "not a url", ""]) {
          const error = yield* Effect.flip(
            config.set({ apiBaseUrl, deviceToken: Redacted.make(deviceToken) }),
          );
          expect(error).toMatchObject({ _tag: "ConfigError", reason: "Invalid" });
        }
        const empty = yield* Effect.flip(
          config.set({ apiBaseUrl: "https://api.example.com", deviceToken: Redacted.make(" ") }),
        );
        expect(empty).toMatchObject({ reason: "Invalid" });
        expect(yield* Effect.flip(config.get)).toMatchObject({ reason: "Missing" });
      }),
    ),
  );

  it.effect("fails with Invalid when storage holds a broken value", () =>
    run(
      Effect.gen(function* () {
        const error = yield* Effect.flip((yield* ExtensionConfig.ExtensionConfig).get);
        expect(error).toMatchObject({ _tag: "ConfigError", reason: "Invalid" });
      }),
      { [ExtensionConfig.storageKey]: { apiBaseUrl: 42 } },
    ),
  );
});
