import * as ClassifyLink from "@stash/backend-enrichment/classify-link";
import * as EnrichmentRepo from "@stash/backend-enrichment/enrichment-repo";
import * as Ai from "@stash/backend-platform/ai";
import * as AnthropicConfig from "@stash/backend-platform/anthropic-config";
import * as Blobs from "@stash/backend-platform/blobs";
import * as D1Database from "@stash/backend-platform/d1-database";
import * as EnrichmentQueue from "@stash/backend-platform/enrichment-queue";
import * as GithubOAuthConfig from "@stash/backend-platform/github-oauth-config";
import * as HttpClientLive from "@stash/backend-platform/http-client";
import * as Kv from "@stash/backend-platform/kv";
import * as StashConfig from "@stash/backend-platform/stash-config";
import * as Vectors from "@stash/backend-platform/vectors";
import { env } from "cloudflare:workers";
import * as Effect from "effect/Effect";
import * as HttpRouter from "effect/http/HttpRouter";
import * as Layer from "effect/Layer";
import * as Scheduler from "effect/Scheduler";
import * as ApiLayer from "./api-layer.ts";
import * as QueueHandler from "./queue-handler.ts";
import * as ScheduledHandler from "./scheduled-handler.ts";
import { handleSmoke } from "./smoke-routes.ts";
import type { WorkerEnv } from "./worker-env.ts";

const workerEnv = env as unknown as WorkerEnv;

/** Stands in for a binding the Worker was deployed without: every call rejects. */
const missingBinding = (name: string) => () =>
  Promise.reject(new Error(`binding ${name} is not configured`));

const platform = Layer.mergeAll(
  D1Database.layer(workerEnv.DB),
  EnrichmentQueue.layer(workerEnv.ENRICHMENT_QUEUE),
  Kv.layer(workerEnv.KV),
  StashConfig.layerFromEnv(workerEnv),
  GithubOAuthConfig.layerFromEnv(workerEnv),
  HttpClientLive.layer,
  Ai.layer(workerEnv.AI ?? { run: missingBinding("AI") }),
  Vectors.layer(
    workerEnv.VECTORS ?? {
      upsert: missingBinding("VECTORS"),
      query: missingBinding("VECTORS"),
      deleteByIds: missingBinding("VECTORS"),
    },
  ),
);

// The enrichment consumer's services. The Anthropic key is a Worker secret. Without it, or without
// the R2 bucket, every message fails and is retried, and nothing is marked as failed.
const enrichment = QueueHandler.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      EnrichmentRepo.layer,
      workerEnv.ANTHROPIC_API_KEY === undefined
        ? ClassifyLink.layerMissingKey
        : ClassifyLink.layerAnthropic.pipe(
            Layer.provide(AnthropicConfig.layerFromEnv(workerEnv)),
            Layer.orDie,
          ),
      Blobs.layer(
        workerEnv.BLOBS ?? {
          put: missingBinding("BLOBS"),
          get: missingBinding("BLOBS"),
          delete: missingBinding("BLOBS"),
        },
      ),
    ),
  ),
  Layer.provide(platform),
);

// Built once per isolate at module scope, as Workers require: fibers started inside `fetch` would
// capture that request's context. Global scope allows no timers, so fibers run on a sync scheduler.
const syncScheduler = Layer.succeed(Scheduler.Scheduler)(new Scheduler.MixedScheduler("sync"));
const app = HttpRouter.toWebHandler(
  ApiLayer.layer.pipe(Layer.provide(platform), Layer.provideMerge(syncScheduler)),
);

export default {
  async fetch(request, env): Promise<Response> {
    return (await handleSmoke(request, env)) ?? app.handler(request);
  },

  async queue(batch): Promise<void> {
    await Effect.runPromise(
      QueueHandler.handleBatch(batch.messages).pipe(Effect.provide(enrichment)),
    );
  },

  async scheduled(controller): Promise<void> {
    await Effect.runPromise(
      ScheduledHandler.handleScheduled(controller.cron).pipe(
        Effect.provide(ScheduledHandler.layerNoop),
      ),
    );
  },
} satisfies ExportedHandler<WorkerEnv>;
