import { handleQueue } from "./queue-handler.ts";
import { handleSmoke } from "./smoke-routes.ts";
import type { EnrichmentMessage, WorkerEnv } from "./worker-env.ts";

// Minimal entry for the Alchemy spike. The Effect HttpApi replaces this fetch handler later.
export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ status: "ok" });
    }
    return (await handleSmoke(request, url, env)) ?? new Response("Not found", { status: 404 });
  },

  async queue(batch: MessageBatch<EnrichmentMessage>, env: WorkerEnv): Promise<void> {
    await handleQueue(batch, env);
  },
} satisfies ExportedHandler<WorkerEnv, EnrichmentMessage>;
