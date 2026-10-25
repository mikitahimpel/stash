import { describe, expect, it } from "@effect/vitest";
import * as Link from "@stash/contracts-domain/link";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Ai from "../src/ai.ts";
import * as Blobs from "../src/blobs.ts";
import * as D1Database from "../src/d1-database.ts";
import * as EnrichmentQueue from "../src/enrichment-queue.ts";
import * as GithubOAuthConfig from "../src/github-oauth-config.ts";
import * as Kv from "../src/kv.ts";
import * as Live from "../src/live.ts";
import * as SqliteD1 from "../src/sqlite-d1.ts";
import * as StashConfig from "../src/stash-config.ts";
import * as Testing from "../src/testing.ts";
import * as Vectors from "../src/vectors.ts";

// Fake bindings stand in for Cloudflare's: the live layer only uses the methods the binding
// interfaces declare, which the real types are checked against in `src/live.ts`.
const fakeEnv = (): Live.PlatformEnv => {
  const kv = new Map<string, string>();
  const sent: Array<unknown> = [];
  const env = {
    DB: SqliteD1.make(),
    ENRICHMENT_QUEUE: {
      send: async (message: unknown) => void sent.push(message),
      sendBatch: async () => {},
    },
    VECTORS: {
      upsert: async () => ({}),
      query: async () => ({ matches: [] }),
      deleteByIds: async () => ({}),
    },
    BLOBS: { put: async () => null, get: async () => null, delete: async () => {} },
    KV: {
      get: async (key: string) => kv.get(key) ?? null,
      put: async (key: string, value: string) => void kv.set(key, value),
      delete: async (key: string) => void kv.delete(key),
    },
    AI: { run: async () => ({ data: [[1, 0]] }) },
    ALLOWED_GITHUB_LOGIN: "example-user",
    WEB_ORIGIN: "https://example.com",
    GITHUB_OAUTH_CLIENT_ID: "synthetic-client-id",
    GITHUB_OAUTH_CLIENT_SECRET: "synthetic-client-secret",
  };
  return env as unknown as Live.PlatformEnv;
};

describe("live layer", () => {
  it.effect("builds every service from env", () =>
    Effect.gen(function* () {
      const db = yield* D1Database.Database;
      expect(yield* db.first(D1Database.sql`SELECT ${1} AS one`)).toEqual(Option.some({ one: 1 }));
      yield* (yield* EnrichmentQueue.EnrichmentQueue).send({
        linkId: Schema.decodeSync(Link.LinkId)("link-1"),
      });
      expect(yield* (yield* Vectors.Vectors).query([1, 0])).toEqual([]);
      expect(yield* (yield* Blobs.Blobs).get("missing")).toEqual(Option.none());
      const kv = yield* Kv.Kv;
      yield* kv.put("k", "v");
      expect(yield* kv.get("k")).toEqual(Option.some("v"));
      expect(yield* (yield* Ai.Ai).embed(["x"])).toEqual([[1, 0]]);
      expect((yield* StashConfig.StashConfig).archiveAfterDays).toBe(30);
      expect((yield* GithubOAuthConfig.GithubOAuthConfig).clientId).toBe("synthetic-client-id");
    }).pipe(Effect.provide(Live.layer(fakeEnv()))),
  );

  it.effect("fails to build when config vars are missing", () =>
    Effect.gen(function* () {
      const { ALLOWED_GITHUB_LOGIN: _, ...env } = fakeEnv();
      const error = yield* Effect.flip(
        Effect.provide(
          Effect.gen(function* () {
            return yield* StashConfig.StashConfig;
          }),
          Live.layer(env as Live.PlatformEnv),
        ),
      );
      expect(error._tag).toBe("StashConfigError");
    }),
  );
});

describe("testing layer", () => {
  it.effect("provides every service in memory", () =>
    Effect.gen(function* () {
      yield* D1Database.Database;
      yield* EnrichmentQueue.EnrichmentQueue;
      yield* Testing.TestEnrichmentQueue;
      yield* Vectors.Vectors;
      yield* Blobs.Blobs;
      yield* Kv.Kv;
      yield* Ai.Ai;
      expect((yield* StashConfig.StashConfig).allowedGithubLogin).toBe("example-user");
      expect((yield* GithubOAuthConfig.GithubOAuthConfig).clientId).toBe("synthetic-client-id");
    }).pipe(Effect.provide(Testing.layer)),
  );
});
