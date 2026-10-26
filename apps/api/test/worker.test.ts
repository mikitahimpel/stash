// Wiring tests for the composed API on Node: the layer builds, `/health` is public, every group is
// routed behind `Authorization`, the auth group is wired (GitHub redirect, session cookies), links
// search, tabs, devices and the digest are served, and CORS follows the web origin. D1 is the
// in-memory platform layer with this package's migrations applied, and GitHub is never called.
// The same checks run against the real Worker in workerd in `local-dev-smoke.test.ts`.
import * as ApiTokenSecret from "@stash/backend-auth/api-token-secret";
import * as GithubClient from "@stash/backend-auth/github-client";
import * as SessionToken from "@stash/backend-auth/session-token";
import * as D1Database from "@stash/backend-platform/d1-database";
import * as Testing from "@stash/backend-platform/testing";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpRouter from "effect/http/HttpRouter";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Fs from "node:fs";
import * as Path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import * as ApiLayer from "../src/api-layer.ts";

const migrationsDir = Path.resolve(import.meta.dirname, "../migrations");
const migrations = Fs.readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => Fs.readFileSync(Path.join(migrationsDir, name), "utf8"));

const webOrigin = "https://web.example.com";
/** Synthetic token. Only its hash is seeded. */
const token = "stash_synthetic-wiring-test-token";
/** Synthetic session cookie value. Only its hash is seeded. */
const session = "synthetic-wiring-test-session";

const layerDatabase = Layer.effectDiscard(
  Effect.gen(function* () {
    const db = yield* D1Database.Database;
    for (const migration of migrations) yield* db.exec(migration);
    const hash = yield* ApiTokenSecret.hash(Redacted.make(token));
    const sessionId = yield* SessionToken.hash(Redacted.make(session));
    yield* db.batch([
      D1Database.sql`INSERT INTO devices (id, name, kind) VALUES ('device-1', 'Synthetic Zen', 'zen')`,
      D1Database.sql`INSERT INTO devices (id, name, kind) VALUES ('device-2', 'Other Zen', 'zen')`,
      D1Database.sql`INSERT INTO api_tokens (id, device_id, hash) VALUES ('token-1', 'device-1', ${hash})`,
      D1Database.sql`INSERT INTO links (id, url, title, type) VALUES ('link-1', 'https://example.com/a', 'Economics explained', 'article')`,
      D1Database.sql`INSERT INTO sessions (id, github_login, expires_at)
        VALUES (${sessionId}, 'example-user', '2999-01-01T00:00:00.000Z')`,
    ]);
  }).pipe(Effect.orDie),
).pipe(Layer.provideMerge(Testing.layerD1Database));

/** Wiring tests never reach GitHub. */
const layerNoNetwork = Layer.succeed(HttpClient.HttpClient)(
  HttpClient.make(() => Effect.die(new Error("unexpected outbound request"))),
);

const app = HttpRouter.toWebHandler(
  ApiLayer.layer.pipe(
    Layer.provide(layerDatabase),
    Layer.provide(Testing.layerStashConfig({ webOrigin })),
    Layer.provide(Testing.layerAi()),
    Layer.provide(Testing.layerVectors),
    Layer.provide(Testing.layerGithubOAuthConfig),
    Layer.provide(layerNoNetwork),
    Layer.provide(Testing.layerEnrichmentQueue),
    Layer.provide(Testing.layerKv),
  ),
  { disableLogger: true },
);

afterAll(() => app.dispose());

const request = (
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: unknown,
) =>
  app.handler(
    new Request(`http://localhost${path}`, {
      method,
      headers: body === undefined ? headers : { ...headers, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );

const bearer = { authorization: `Bearer ${token}` };
const cookie = { cookie: `stash_session=${session}` };

describe("composed API", () => {
  it("serves /health without credentials", async () => {
    const response = await request("GET", "/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it.each([
    ["GET", "/links"],
    ["GET", "/search?q=x"],
    ["GET", "/devices"],
    ["GET", "/tokens"],
    ["GET", "/auth/me"],
    ["GET", "/digest/latest"],
  ])("answers 401 to %s %s without a credential", async (method, path) => {
    const response = await request(method, path);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ _tag: "Unauthorized" });
  });

  it("rejects an unknown bearer token", async () => {
    const response = await request("GET", "/links", { authorization: "Bearer stash_unknown" });
    expect(response.status).toBe(401);
  });

  it("serves the tokens group to a seeded bearer token", async () => {
    const response = await request("GET", "/tokens", bearer);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      expect.objectContaining({ id: "token-1", deviceId: "device-1", revokedAt: null }),
    ]);
  });

  it("serves the search group from FTS5 (hybrid by default) with filters", async () => {
    const response = await request("GET", "/search?q=economics", bearer);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      hits: [
        {
          link: expect.objectContaining({ id: "link-1", title: "Economics explained", tags: [] }),
          score: expect.any(Number),
        },
      ],
    });

    const filtered = await request("GET", "/search?q=economics&mode=keyword&type=video", bearer);
    expect(filtered.status).toBe(200);
    expect(await filtered.json()).toEqual({ hits: [] });
  });

  it("serves the links group: save as the token's device, then list", async () => {
    const saved = await request("POST", "/links", bearer, {
      url: "https://www.example.com/wiring/?utm_source=test",
    });
    expect(saved.status).toBe(201);
    expect(await saved.json()).toMatchObject({
      canonicalUrl: "https://example.com/wiring",
      sourceDeviceId: "device-1",
      status: "new",
    });

    const listed = await request("GET", "/links?seen=false&limit=10", bearer);
    expect(listed.status).toBe(200);
    expect(await listed.json()).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ url: "https://www.example.com/wiring/?utm_source=test" }),
      ]),
      nextCursor: null,
    });
  });

  it("answers 400 to an unknown links cursor", async () => {
    const response = await request("GET", "/links?cursor=bogus", bearer);
    expect(response.status).toBe(400);
  });

  it("serves the tabs and devices groups, keeping a device to its own tabs and commands", async () => {
    const tabs = { takenAt: "2026-01-01T00:00:00.000Z", tabs: [] };
    expect((await request("PUT", "/devices/device-1/tabs", bearer, tabs)).status).toBe(204);
    const other = await request("PUT", "/devices/device-2/tabs", bearer, tabs);
    expect(other.status).toBe(403);
    expect(await other.json()).toMatchObject({ _tag: "Forbidden" });
    expect((await request("GET", "/devices/device-2/commands", bearer)).status).toBe(403);
    expect((await request("PUT", "/devices/device-1/tabs", {}, tabs)).status).toBe(401);

    const listed = await request("GET", "/tabs", cookie);
    expect(listed.status).toBe(200);
    expect(await listed.json()).toMatchObject({
      devices: expect.arrayContaining([
        expect.objectContaining({ device: expect.objectContaining({ id: "device-1" }) }),
      ]),
    });

    const sent = await request("POST", "/devices/device-1/commands", cookie, {
      kind: "close-tab",
      url: "https://example.com/tab",
    });
    expect(sent.status).toBe(201);
    const command = (await sent.json()) as { id: string };
    const ack = await request("POST", `/commands/${command.id}/ack`, bearer, { status: "done" });
    expect(ack.status).toBe(200);
    expect(await ack.json()).toMatchObject({ id: command.id, status: "done" });
    expect((await request("GET", "/devices", bearer)).status).toBe(200);
  });

  it("serves the digest group: 404 until the first digest is built", async () => {
    const response = await request("GET", "/digest/latest", bearer);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ _tag: "NotFound", resource: "digest" });
  });

  it("starts the GitHub login without credentials", async () => {
    const login = await request("GET", "/auth/github/login");
    expect(login.status).toBe(302);
    expect(login.headers.get("location")).toMatch(
      new RegExp(`^${GithubClient.authorizeEndpoint}\\?client_id=synthetic-client-id&`),
    );
    expect(login.headers.getSetCookie()).toEqual([
      expect.stringMatching(/^stash_oauth_state=[\w-]+; .*HttpOnly; Secure; SameSite=Lax$/),
    ]);
  });

  it("rejects a callback without the state cookie with 400", async () => {
    const response = await request("GET", "/auth/github/callback?code=c&state=s");
    expect(response.status).toBe(400);
  });

  it("authenticates a session cookie and logs it out", async () => {
    const me = await request("GET", "/auth/me", cookie);
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({ kind: "user" });
    expect((await request("GET", "/tokens", cookie)).status).toBe(200);
    expect(await (await request("GET", "/auth/me", bearer)).json()).toEqual({
      kind: "device",
      deviceId: "device-1",
    });

    const logout = await request("POST", "/auth/logout", cookie);
    expect(logout.status).toBe(204);
    expect(logout.headers.getSetCookie()).toEqual([expect.stringMatching(/^stash_session=;/)]);
    expect((await request("GET", "/auth/me", cookie)).status).toBe(401);
  });

  it("allows CORS with credentials from the web origin only", async () => {
    const preflight = (origin: string) =>
      request("OPTIONS", "/links", {
        origin,
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization, content-type",
      });
    const allowed = await preflight(webOrigin);
    expect(allowed.status).toBeLessThan(300);
    expect(allowed.headers.get("access-control-allow-origin")).toBe(webOrigin);
    expect(allowed.headers.get("access-control-allow-credentials")).toBe("true");

    const other = await preflight("https://other.example.com");
    expect(other.headers.get("access-control-allow-origin")).not.toBe("https://other.example.com");

    const simple = await request("GET", "/health", { origin: webOrigin });
    expect(simple.headers.get("access-control-allow-origin")).toBe(webOrigin);
  });
});
