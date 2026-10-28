import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as GithubConfig from "../src/github-config.ts";

describe("GithubConfig", () => {
  it.effect("reads the client id from env", () =>
    Effect.gen(function* () {
      const config = yield* GithubConfig.fromEnv({ GITHUB_CLIENT_ID: "synthetic-client-id" });
      expect(config).toEqual({ clientId: "synthetic-client-id" });
    }),
  );

  it.effect("rejects a missing or empty client id", () =>
    Effect.gen(function* () {
      for (const bad of [{}, { GITHUB_CLIENT_ID: "" }, { GITHUB_CLIENT_ID: 42 }]) {
        const error = yield* Effect.flip(GithubConfig.fromEnv(bad));
        expect(error._tag).toBe("GithubConfigError");
      }
    }),
  );
});
