import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as GithubOAuthConfig from "../src/github-oauth-config.ts";

/** Synthetic placeholders, not real credentials. */
const env = {
  GITHUB_OAUTH_CLIENT_ID: "synthetic-client-id",
  GITHUB_OAUTH_CLIENT_SECRET: "synthetic-client-secret",
};

describe("GithubOAuthConfig", () => {
  it.effect("reads the credentials from env and keeps the secret redacted", () =>
    Effect.gen(function* () {
      const config = yield* GithubOAuthConfig.fromEnv(env);
      expect(config.clientId).toBe("synthetic-client-id");
      expect(Redacted.value(config.clientSecret)).toBe("synthetic-client-secret");
      expect(String(config.clientSecret)).not.toContain("synthetic-client-secret");
    }),
  );

  it.effect("rejects missing or empty credentials without echoing them", () =>
    Effect.gen(function* () {
      for (const bad of [
        {},
        { ...env, GITHUB_OAUTH_CLIENT_ID: "" },
        { GITHUB_OAUTH_CLIENT_ID: "synthetic-client-id", GITHUB_OAUTH_CLIENT_SECRET: 42 },
      ]) {
        const error = yield* Effect.flip(GithubOAuthConfig.fromEnv(bad));
        expect(error._tag).toBe("GithubOAuthConfigError");
        expect(JSON.stringify(error)).not.toContain("synthetic-client-id");
      }
    }),
  );
});
