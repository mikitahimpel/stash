import * as Ai from "@stash/backend-platform/ai";
import * as D1Database from "@stash/backend-platform/d1-database";
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
  StashConfig.layerFromEnv(workerEnv),
  Ai.layer(workerEnv.AI ?? { run: missingBinding("AI") }),
  Vectors.layer(
    workerEnv.VECTORS ?? {
      upsert: missingBinding("VECTORS"),
      query: missingBinding("VECTORS"),
      deleteByIds: missingBinding("VECTORS"),
    },
  ),
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
      QueueHandler.handleBatch(batch.messages).pipe(Effect.provide(QueueHandler.layerNoop)),
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
