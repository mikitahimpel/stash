import { seed } from "./smoke-seed.ts";
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

  // Everything seeded here belongs to the owner (the user `owner` the migrations create).

  // Seeds a device and an API token from the token's SHA-256 hash (never the plaintext), so the
  // smoke test can authenticate against the HttpApi.
  if (request.method === "POST" && url.pathname === "/_smoke/api-token") {
    const { hash } = await request.json<{ hash: string }>();
    const deviceId = `smoke-device-${crypto.randomUUID()}`;
    const tokenId = `smoke-token-${crypto.randomUUID()}`;
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO devices (id, user_id, name, kind) VALUES (?, 'owner', ?, 'zen')",
      ).bind(deviceId, "Smoke device"),
      env.DB.prepare(
        "INSERT INTO api_tokens (id, user_id, device_id, hash) VALUES (?, 'owner', ?, ?)",
      ).bind(tokenId, deviceId, hash),
    ]);
    return Response.json({ deviceId, tokenId }, { status: 201 });
  }

  // Seeds synthetic devices, links and open tabs for the web screenshots (see smoke-seed.ts).
  if (request.method === "POST" && url.pathname === "/_smoke/seed") {
    return Response.json(await seed(env), { status: 201 });
  }

  // Seeds a web session for the allowlisted login from the session token's SHA-256 hash (never the
  // plaintext), so the screenshot script can sign in without GitHub. It sets the cookie itself.
  if (request.method === "POST" && url.pathname === "/_smoke/session") {
    const { hash } = await request.json<{ hash: string }>();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await env.DB.prepare(
      "INSERT INTO sessions (id, user_id, github_login, expires_at) VALUES (?, 'owner', ?, ?)",
    )
      .bind(hash, env.ALLOWED_GITHUB_LOGIN, expiresAt)
      .run();
    return Response.json({ expiresAt }, { status: 201 });
  }

  // Seeds an open invite from its token's SHA-256 hash, for the invite page (#178).
  if (request.method === "POST" && url.pathname === "/_smoke/invite") {
    const { hash } = await request.json<{ hash: string }>();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await env.DB.prepare(
      "INSERT INTO invites (id, token_hash, created_by, expires_at) VALUES (?, ?, 'owner', ?)",
    )
      .bind(`smoke-invite-${crypto.randomUUID()}`, hash, expiresAt)
      .run();
    return Response.json({ expiresAt }, { status: 201 });
  }

  // Gives the owner two synthetic passkeys and a linked Google account, for the screenshots of
  // Settings → Security. Their keys sign nothing: they are never used to sign in.
  if (request.method === "POST" && url.pathname === "/_smoke/sign-in-methods") {
    const day = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT OR IGNORE INTO passkeys (id, user_id, public_key, synced, name, created_at, last_used_at) VALUES ('c21va2UtcGFzc2tleS1waG9uZQ', 'owner', 'AA', 1, 'iCloud Keychain', ?, ?)",
      ).bind(day(40), day(1)),
      env.DB.prepare(
        "INSERT OR IGNORE INTO passkeys (id, user_id, public_key, synced, name, created_at) VALUES ('c21va2UtcGFzc2tleS1rZXk', 'owner', 'AA', 0, 'Security key', ?)",
      ).bind(day(12)),
      env.DB.prepare(
        "INSERT OR IGNORE INTO user_identities (provider, subject, user_id, label) VALUES ('google', 'smoke-google-sub', 'owner', 'owner@example.com')",
      ),
    ]);
    return new Response(null, { status: 201 });
  }

  if (request.method === "POST" && url.pathname === "/_smoke/queue") {
    const linkId = `smoke-link-${crypto.randomUUID()}`;
    await env.ENRICHMENT_QUEUE.send({ linkId });
    return Response.json({ sent: linkId }, { status: 202 });
  }

  return new Response("Not found", { status: 404 });
};
