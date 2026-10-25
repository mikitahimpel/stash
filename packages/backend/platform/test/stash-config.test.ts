import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as StashConfig from "../src/stash-config.ts";
import * as Testing from "../src/testing.ts";

const env = { ALLOWED_GITHUB_LOGIN: "example-user", WEB_ORIGIN: "https://example.com" };

describe("StashConfig", () => {
  it.effect("reads vars from env, with a default archive age", () =>
    Effect.gen(function* () {
      expect(yield* StashConfig.fromEnv(env)).toEqual({
        allowedGithubLogin: "example-user",
        webOrigin: "https://example.com",
        archiveAfterDays: 30,
      });
      const custom = yield* StashConfig.fromEnv({ ...env, ARCHIVE_AFTER_DAYS: "7" });
      expect(custom.archiveAfterDays).toBe(7);
    }),
  );

  it.effect("rejects missing or invalid vars", () =>
    Effect.gen(function* () {
      for (const bad of [
        {},
        { ...env, ALLOWED_GITHUB_LOGIN: "" },
        { ...env, WEB_ORIGIN: "https://example.com/app" },
        { ...env, WEB_ORIGIN: "not a url" },
        { ...env, ARCHIVE_AFTER_DAYS: "0" },
        { ...env, ARCHIVE_AFTER_DAYS: "1.5" },
      ]) {
        const error = yield* Effect.flip(StashConfig.fromEnv(bad));
        expect(error._tag).toBe("StashConfigError");
      }
    }),
  );

  it.effect("the test layer is synthetic and overridable", () =>
    Effect.gen(function* () {
      const config = yield* StashConfig.StashConfig;
      expect(config).toEqual({
        allowedGithubLogin: "example-user",
        webOrigin: "https://example.com",
        archiveAfterDays: 3,
      });
    }).pipe(Effect.provide(Testing.layerStashConfig({ archiveAfterDays: 3 }))),
  );
});
