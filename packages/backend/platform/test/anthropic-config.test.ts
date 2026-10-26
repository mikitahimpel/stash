import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as AnthropicConfig from "../src/anthropic-config.ts";

/** A synthetic placeholder, not a real key. */
const env = { ANTHROPIC_API_KEY: "synthetic-anthropic-key" };

describe("AnthropicConfig", () => {
  it.effect("reads the key from env and keeps it redacted", () =>
    Effect.gen(function* () {
      const config = yield* AnthropicConfig.fromEnv(env);
      expect(Redacted.value(config.apiKey)).toBe("synthetic-anthropic-key");
      expect(String(config.apiKey)).not.toContain("synthetic-anthropic-key");
    }),
  );

  it.effect("rejects a missing or invalid key without echoing it", () =>
    Effect.gen(function* () {
      for (const bad of [{}, { ANTHROPIC_API_KEY: "" }, { ANTHROPIC_API_KEY: 42 }]) {
        const error = yield* Effect.flip(AnthropicConfig.fromEnv(bad));
        expect(error._tag).toBe("AnthropicConfigError");
        expect(JSON.stringify(error)).not.toContain("synthetic");
      }
    }),
  );
});
