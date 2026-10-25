// Wiring tests for the composed API on Node: the layer builds, `/health` is public, every group is
// routed behind `Authorization`, the auth group is wired (GitHub redirect, session cookies),
// unimplemented groups answer 501, and CORS follows the web origin. D1 is the in-memory platform
// layer with this package's migrations applied, and GitHub is never called. The same checks run
// against the real Worker in workerd in `local-dev-smoke.test.ts`.
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
      D1Database.sql`INSERT INTO api_tokens (id, device_id, hash) VALUES ('token-1', 'device-1', ${hash})`,
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
    Layer.provide(Testing.layerGithubOAuthConfig),
    Layer.provide(layerNoNetwork),
  ),
  { disableLogger: true },
);

afterAll(() => app.dispose());

const request = (method: string, path: string, headers: Record<string, string> = {}) =>
  app.handler(new Request(`http://localhost${path}`, { method, headers }));

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

  it("answers 501 NotImplemented for groups that have not landed", async () => {
    const response = await request("GET", "/links", bearer);
    expect(response.status).toBe(501);
    expect(await response.json()).toEqual({ _tag: "NotImplemented", endpoint: "links.list" });
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
