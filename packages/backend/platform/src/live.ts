import * as Layer from "effect/Layer";
import * as Ai from "./ai.ts";
import * as Blobs from "./blobs.ts";
import * as D1Database from "./d1-database.ts";
import * as EnrichmentQueue from "./enrichment-queue.ts";
import * as GithubOAuthConfig from "./github-oauth-config.ts";
import * as Kv from "./kv.ts";
import * as StashConfig from "./stash-config.ts";
import * as Vectors from "./vectors.ts";

/**
 * The bindings and vars the platform reads from the Worker `env`. The binding names must match the
 * `Api` Worker in the root `alchemy.run.ts`.
 */
export interface PlatformEnv extends StashConfig.Env, GithubOAuthConfig.Env {
  readonly DB: D1Database;
  readonly ENRICHMENT_QUEUE: Queue<typeof EnrichmentQueue.EnrichmentMessage.Encoded>;
  readonly VECTORS: Vectorize;
  readonly BLOBS: R2Bucket;
  readonly KV: KVNamespace;
  readonly AI: Ai;
}

/** Every platform service. */
export type Services =
  | D1Database.Database
  | EnrichmentQueue.EnrichmentQueue
  | Vectors.Vectors
  | Blobs.Blobs
  | Kv.Kv
  | Ai.Ai
  | StashConfig.StashConfig
  | GithubOAuthConfig.GithubOAuthConfig;

/** Every service, built from the Worker `env`. Fails if a config var is missing or invalid. */
export const layer = (
  env: PlatformEnv,
): Layer.Layer<Services, StashConfig.StashConfigError | GithubOAuthConfig.GithubOAuthConfigError> =>
  Layer.mergeAll(
    D1Database.layer(env.DB),
    EnrichmentQueue.layer(env.ENRICHMENT_QUEUE),
    Vectors.layer(env.VECTORS),
    Blobs.layer(env.BLOBS),
    Kv.layer(env.KV),
    Ai.layer(env.AI),
    StashConfig.layerFromEnv(env),
    GithubOAuthConfig.layerFromEnv(env),
  );
