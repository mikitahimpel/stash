import type { WorkerEnv } from "./worker-env.ts";

// Dev-only routes that let the local-dev smoke test reach D1 and the queue directly. They answer
// 404 unless SMOKE_ROUTES is "on", which `alchemy.run.ts` sets only under `alchemy dev`. Remove
// them once feature endpoints cover the schema and the queue.
export const handleSmoke = async (
  request: Request,
  env: WorkerEnv,
): Promise<Response | undefined> => {
  const url = new URL(request.url);
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

  // Lists the tables the D1 migrations created, so the smoke test can see Alchemy applied them.
  if (request.method === "GET" && url.pathname === "/_smoke/schema") {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name",
    ).all<{ name: string }>();
    return Response.json({ tables: results.map((row) => row.name) });
  }

  // Seeds a device and an API token from the token's SHA-256 hash (never the plaintext), so the
  // smoke test can authenticate against the HttpApi.
  if (request.method === "POST" && url.pathname === "/_smoke/api-token") {
    const { hash } = await request.json<{ hash: string }>();
    const deviceId = `smoke-device-${crypto.randomUUID()}`;
    const tokenId = `smoke-token-${crypto.randomUUID()}`;
    await env.DB.batch([
      env.DB.prepare("INSERT INTO devices (id, name, kind) VALUES (?, ?, 'zen')").bind(
        deviceId,
        "Smoke device",
      ),
      env.DB.prepare("INSERT INTO api_tokens (id, device_id, hash) VALUES (?, ?, ?)").bind(
        tokenId,
        deviceId,
        hash,
      ),
    ]);
    return Response.json({ deviceId, tokenId }, { status: 201 });
  }

  if (request.method === "POST" && url.pathname === "/_smoke/queue") {
    const linkId = `smoke-link-${crypto.randomUUID()}`;
    await env.ENRICHMENT_QUEUE.send({ linkId });
    return Response.json({ sent: linkId }, { status: 202 });
  }

  return new Response("Not found", { status: 404 });
};
