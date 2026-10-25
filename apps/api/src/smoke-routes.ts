import type { WorkerEnv } from "./worker-env.ts";

// Spike-only routes that prove the local D1 and Queue bindings work. They answer 404 unless
// SMOKE_ROUTES is "on", which `alchemy.run.ts` sets only under `alchemy dev`. Remove them once the
// HttpApi and its tests cover D1 and the queue.
export const handleSmoke = async (
  request: Request,
  url: URL,
  env: WorkerEnv,
): Promise<Response | undefined> => {
  if (env.SMOKE_ROUTES !== "on" || !url.pathname.startsWith("/_smoke/")) return undefined;

  if (request.method === "POST" && url.pathname === "/_smoke/d1") {
    const id = crypto.randomUUID();
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS smoke_rows (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL)",
    ).run();
    await env.DB.prepare("INSERT INTO smoke_rows (id, created_at) VALUES (?, ?)")
      .bind(id, Date.now())
      .run();
    const row = await env.DB.prepare("SELECT id FROM smoke_rows WHERE id = ?")
      .bind(id)
      .first<{ id: string }>();
    return Response.json({ written: id, read: row?.id ?? null });
  }

  if (request.method === "POST" && url.pathname === "/_smoke/queue") {
    const id = crypto.randomUUID();
    await env.ENRICHMENT_QUEUE.send({ id });
    return Response.json({ sent: id }, { status: 202 });
  }

  const receipt = /^\/_smoke\/queue\/([\w-]+)$/.exec(url.pathname);
  if (request.method === "GET" && receipt) {
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS smoke_queue_receipts (id TEXT PRIMARY KEY, received_at INTEGER NOT NULL)",
    ).run();
    const row = await env.DB.prepare("SELECT id FROM smoke_queue_receipts WHERE id = ?")
      .bind(receipt[1])
      .first<{ id: string }>();
    return row ? Response.json({ received: row.id }) : new Response("not yet", { status: 404 });
  }

  return new Response("Not found", { status: 404 });
};
