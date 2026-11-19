// Boots the root `alchemy.run.ts` under `alchemy dev` (no Cloudflare credentials) and drives the
// real Worker in workerd over HTTP: health, the HttpApi behind `Authorization` (401 without a
// credential, a bearer token seeded by its hash), CORS, D1 and its migrations, and one queue
// message through the consumer, and the live stream of link changes over its Durable Object.
import { type ChildProcess, spawn } from "node:child_process";
import * as Crypto from "node:crypto";
import * as Http from "node:http";
import * as Path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repoRoot = Path.resolve(import.meta.dirname, "../../..");
const port = Number(process.env["STASH_SMOKE_PORT"] ?? 8788);
const baseUrl = `http://localhost:${port}`;
// Synthetic, passed to the Worker as its WEB_ORIGIN.
const webOrigin = "https://web.example.com";

interface SmokeResponse {
  readonly status: number;
  readonly headers: Http.IncomingHttpHeaders;
  readonly body: string;
}

interface CallOptions {
  readonly headers?: Record<string, string>;
  readonly body?: unknown;
}

// node:http keeps the test off the `fetch` global, which oxlint reserves for platform packages.
const call = (method: string, path: string, options: CallOptions = {}): Promise<SmokeResponse> =>
  new Promise((resolve, reject) => {
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);
    const headers = {
      ...options.headers,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    };
    const req = Http.request(`${baseUrl}${path}`, { method, headers }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => (text += chunk));
      res.on("end", () =>
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: text }),
      );
    });
    req.on("error", reject);
    req.end(body);
  });

/**
 * Opens `path` as a WebSocket with `headers` (the global `WebSocket` takes none) and collects the
 * text messages the server sends. Server frames are not masked, and these are all short text.
 */
const openStream = (
  path: string,
  headers: Record<string, string>,
): Promise<{ readonly messages: Array<string>; readonly close: () => void }> =>
  new Promise((resolve, reject) => {
    const req = Http.request(`${baseUrl}${path}`, {
      headers: {
        ...headers,
        connection: "Upgrade",
        upgrade: "websocket",
        "sec-websocket-version": "13",
        "sec-websocket-key": Crypto.randomBytes(16).toString("base64"),
      },
    });
    req.on("response", (res) => reject(new Error(`no upgrade: ${res.statusCode}`)));
    req.on("error", reject);
    req.on("upgrade", (_res, socket, head) => {
      const messages: Array<string> = [];
      let buffer = Buffer.from(head);
      const read = () => {
        while (buffer.length >= 2) {
          const opcode = buffer[0]! & 0x0f;
          let length = buffer[1]! & 0x7f;
          let offset = 2;
          if (length === 126) {
            if (buffer.length < 4) return;
            length = buffer.readUInt16BE(2);
            offset = 4;
          } else if (length === 127) {
            if (buffer.length < 10) return;
            length = Number(buffer.readBigUInt64BE(2));
            offset = 10;
          }
          if (buffer.length < offset + length) return;
          if (opcode === 1) messages.push(buffer.toString("utf8", offset, offset + length));
          buffer = buffer.subarray(offset + length);
        }
      };
      socket.on("data", (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);
        read();
      });
      read();
      resolve({ messages, close: () => socket.destroy() });
    });
    req.end();
  });

let dev: ChildProcess | undefined;
let output = "";

const waitFor = async <A>(
  what: string,
  attempt: () => Promise<A | undefined>,
  timeoutMs: number,
): Promise<A> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await attempt().catch(() => undefined);
    if (result !== undefined) return result;
    if (dev?.exitCode != null) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timed out waiting for ${what}; alchemy dev output:\n${output}`);
};

const stopDev = async (): Promise<void> => {
  const child = dev;
  if (child?.pid === undefined || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  // SIGINT lets alchemy stop workerd and its sidecar. Fall back to killing the process group.
  process.kill(-child.pid, "SIGINT");
  const timer = setTimeout(() => process.kill(-child.pid!, "SIGKILL"), 10_000);
  await exited;
  clearTimeout(timer);
};

beforeAll(async () => {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    STASH_API_PORT: String(port),
    // The stack also starts the `Mcp` Worker. Keep it off the default dev port.
    STASH_MCP_PORT: String(port + 1),
    STASH_WEB_ORIGIN: webOrigin,
  };
  // Prove that no Cloudflare credentials are needed.
  for (const key of Object.keys(env)) if (key.startsWith("CLOUDFLARE_")) delete env[key];

  dev = spawn("node_modules/.bin/alchemy", ["dev", "--stage", "smoke"], {
    cwd: repoRoot,
    env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  dev.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString()));
  dev.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString()));

  await waitFor(
    "GET /health",
    async () => ((await call("GET", "/health")).status === 200 ? true : undefined),
    90_000,
  );
});

afterAll(stopDev);

describe("alchemy dev (local, no credentials)", () => {
  it("serves GET /health without credentials", async () => {
    const response = await call("GET", "/health");
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ status: "ok" });
  });

  it("answers 401 Unauthorized to GET /links without a credential", async () => {
    const response = await call("GET", "/links");
    expect(response.status).toBe(401);
    expect(JSON.parse(response.body)).toMatchObject({ _tag: "Unauthorized" });
  });

  it("authenticates a bearer token seeded by its hash", async () => {
    // Synthetic token, generated per run. Only its hash goes to D1.
    const token = `stash_smoke-${Crypto.randomBytes(32).toString("base64url")}`;
    const hash = Crypto.createHash("sha256").update(token).digest("hex");
    const seeded = await call("POST", "/_smoke/api-token", { body: { hash } });
    expect(seeded.status).toBe(201);
    const { tokenId } = JSON.parse(seeded.body) as { tokenId: string };
    const authorization = `Bearer ${token}`;

    const tokens = await call("GET", "/tokens", { headers: { authorization } });
    expect(tokens.status).toBe(200);
    expect(JSON.parse(tokens.body)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: tokenId, revokedAt: null })]),
    );

    // Past the middleware, the links group saves into D1 (deduping) and lists.
    const body = { url: `https://example.com/smoke/${tokenId}` };
    const saved = await call("POST", "/links", { headers: { authorization }, body });
    expect(saved.status).toBe(201);
    const link = JSON.parse(saved.body) as { id: string };
    const again = await call("POST", "/links", { headers: { authorization }, body });
    expect(JSON.parse(again.body)).toMatchObject({ id: link.id });
    const links = await call("GET", "/links", { headers: { authorization } });
    expect(links.status).toBe(200);
    expect(JSON.parse(links.body)).toMatchObject({
      items: expect.arrayContaining([expect.objectContaining({ id: link.id })]),
    });

    // The digest group is served. Local D1 state persists across runs, so a digest a cron built in
    // an earlier session may exist; otherwise it answers 404 until the first one is built.
    const digest = await call("GET", "/digest/latest", { headers: { authorization } });
    expect([200, 404]).toContain(digest.status);
    if (digest.status === 404) expect(JSON.parse(digest.body)).toMatchObject({ _tag: "NotFound" });

    // `alchemy dev` has no Vectorize or Workers AI: hybrid search answers from FTS5 alone, and
    // semantic search fails.
    const hybrid = await call("GET", "/search?q=smoke", { headers: { authorization } });
    expect(hybrid.status).toBe(200);
    expect(JSON.parse(hybrid.body)).toEqual({ hits: [] });
    const semantic = await call("GET", "/search?q=smoke&mode=semantic", {
      headers: { authorization },
    });
    expect(semantic.status).toBe(500);

    const wrong = await call("GET", "/tokens", { headers: { authorization: `${authorization}x` } });
    expect(wrong.status).toBe(401);
  });

  it("streams a link's change over the LinkEvents Durable Object", async () => {
    const token = `stash_smoke-${Crypto.randomBytes(32).toString("base64url")}`;
    const hash = Crypto.createHash("sha256").update(token).digest("hex");
    expect((await call("POST", "/_smoke/api-token", { body: { hash } })).status).toBe(201);
    const authorization = `Bearer ${token}`;

    // Guarded like every endpoint, and a plain request is told to upgrade.
    await expect(openStream("/events", {})).rejects.toThrow("no upgrade: 401");
    expect((await call("GET", "/events", { headers: { authorization } })).status).toBe(426);

    const stream = await openStream("/events", { authorization });
    const second = await openStream("/events", { authorization });
    try {
      const events = (from: { readonly messages: Array<string> }) =>
        from.messages.map(
          (text) => JSON.parse(text) as { type: string; link?: { id: string; status: string } },
        );
      await waitFor(
        "stream.ready",
        async () => (events(stream)[0]?.type === "stream.ready" ? true : undefined),
        10_000,
      );

      const saved = await call("POST", "/links", {
        headers: { authorization },
        body: { url: `https://example.com/smoke/live/${Crypto.randomUUID()}` },
      });
      const link = JSON.parse(saved.body) as { id: string };
      const patched = await call("PATCH", `/links/${link.id}`, {
        headers: { authorization },
        body: { status: "seen" },
      });
      expect(patched.status).toBe(200);

      // Every open stream of the user gets the whole link: once for the save (so it appears in
      // an Inbox open on another device), once for the change.
      for (const open of [stream, second]) {
        const mine = () =>
          events(open).filter(
            (event) => event.type === "link.updated" && event.link?.id === link.id,
          ) as Array<{ link: { id: string; status: string } }>;
        await waitFor(
          "link.updated twice",
          async () => (mine().length >= 2 ? true : undefined),
          10_000,
        );
        expect(mine().map((event) => event.link.status)).toEqual(["new", "seen"]);
      }

      // The catch-up call a client makes after a gap finds the same change.
      const { updatedAt } = JSON.parse(patched.body) as { updatedAt: string };
      const since = await call("GET", `/links?updatedSince=${encodeURIComponent(updatedAt)}`, {
        headers: { authorization },
      });
      expect(JSON.parse(since.body)).toMatchObject({
        items: expect.arrayContaining([expect.objectContaining({ id: link.id })]),
      });

      const removed = await call("DELETE", `/links/${link.id}`, { headers: { authorization } });
      expect(removed.status).toBe(204);
      await waitFor(
        "link.deleted",
        async () =>
          events(stream).some((event) => event.type === "link.deleted") ? true : undefined,
        10_000,
      );
    } finally {
      stream.close();
      second.close();
    }
  });

  it("allows CORS from the web origin only", async () => {
    const preflight = (origin: string) =>
      call("OPTIONS", "/links", {
        headers: {
          origin,
          "access-control-request-method": "GET",
          "access-control-request-headers": "authorization",
        },
      });
    const allowed = await preflight(webOrigin);
    expect(allowed.status).toBeLessThan(300);
    expect(allowed.headers["access-control-allow-origin"]).toBe(webOrigin);
    expect(allowed.headers["access-control-allow-credentials"]).toBe("true");

    const other = await preflight("https://other.example.com");
    expect(other.headers["access-control-allow-origin"]).not.toBe("https://other.example.com");
  });

  it("writes and reads a D1 row", async () => {
    const response = await call("POST", "/_smoke/d1");
    expect(response.status).toBe(200);
    const body = JSON.parse(response.body) as { written: string; read: string | null };
    expect(body.read).toBe(body.written);
  });

  it("applies the D1 migrations", async () => {
    const response = await call("GET", "/_smoke/schema");
    expect(response.status).toBe(200);
    const { tables } = JSON.parse(response.body) as { tables: ReadonlyArray<string> };
    expect(tables).toEqual(expect.arrayContaining(["links", "links_fts", "devices", "sessions"]));
  });

  it("delivers a queue message to the consumer", async () => {
    const response = await call("POST", "/_smoke/queue");
    expect(response.status).toBe(202);
    const { sent } = JSON.parse(response.body) as { sent: string };

    await waitFor(
      "queue delivery",
      async () => (output.includes(`enrichment: received ${sent}`) ? true : undefined),
      30_000,
    );
  });
});
