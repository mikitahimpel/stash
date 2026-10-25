// Wiring tests for the composed API on Node: the layer builds, `/health` is public, every group is
// routed behind `Authorization`, unimplemented groups answer 501, and CORS follows the web origin.
// D1 is the in-memory platform layer with this package's migrations applied. The same checks run
// against the real Worker in workerd in `local-dev-smoke.test.ts`.
import * as ApiTokenSecret from "@stash/backend-auth/api-token-secret";
import * as D1Database from "@stash/backend-platform/d1-database";
import * as Testing from "@stash/backend-platform/testing";
import * as Effect from "effect/Effect";
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

const layerDatabase = Layer.effectDiscard(
  Effect.gen(function* () {
    const db = yield* D1Database.Database;
    for (const migration of migrations) yield* db.exec(migration);
    const hash = yield* ApiTokenSecret.hash(Redacted.make(token));
    yield* db.batch([
      D1Database.sql`INSERT INTO devices (id, name, kind) VALUES ('device-1', 'Synthetic Zen', 'zen')`,
      D1Database.sql`INSERT INTO api_tokens (id, device_id, hash) VALUES ('token-1', 'device-1', ${hash})`,
    ]);
  }).pipe(Effect.orDie),
).pipe(Layer.provideMerge(Testing.layerD1Database));

const app = HttpRouter.toWebHandler(
  ApiLayer.layer.pipe(
    Layer.provide(layerDatabase),
    Layer.provide(Testing.layerStashConfig({ webOrigin })),
  ),
  { disableLogger: true },
);

afterAll(() => app.dispose());

const request = (method: string, path: string, headers: Record<string, string> = {}) =>
  app.handler(new Request(`http://localhost${path}`, { method, headers }));

const bearer = { authorization: `Bearer ${token}` };

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

    const login = await request("GET", "/auth/github/login");
    expect(login.status).toBe(501);
    expect(await login.json()).toEqual({ _tag: "NotImplemented", endpoint: "auth.githubLogin" });
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
