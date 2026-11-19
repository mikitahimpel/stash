// Wiring tests for the composed API on Node: the layer builds, `/health` is public, every group is
// routed behind `Authorization`, the auth group is wired (device flow, session cookies), links
// search, tabs, devices and the digest are served, and CORS follows the web origin. D1 is the
// in-memory platform layer with the schema the migrations create (`d1-schema.test.ts` checks that
// it is the same) and two users, and GitHub is never called.
// The same checks run against the real Worker in workerd in `local-dev-smoke.test.ts`.
import * as ApiTokenSecret from "@stash/backend-auth/api-token-secret";
import * as SessionToken from "@stash/backend-auth/session-token";
import * as D1Database from "@stash/backend-platform/d1-database";
import * as LinkEvents from "@stash/backend-platform/link-events";
import * as Testing from "@stash/backend-platform/testing";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpRouter from "effect/http/HttpRouter";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { afterAll, describe, expect, it } from "vitest";
import * as ApiLayer from "../src/api-layer.ts";
import * as EventsUpgrade from "../src/events-upgrade.ts";

const webOrigin = "https://web.example.com";
/** Synthetic token. Only its hash is seeded. */
const token = "stash_synthetic-wiring-test-token";
/** Synthetic session cookie value. Only its hash is seeded. */
const session = "synthetic-wiring-test-session";

/** The same for the second user (`Testing.member`). */
const memberToken = "stash_synthetic-wiring-member-token";
const memberSession = "synthetic-wiring-member-session";

const layerDatabase = Layer.effectDiscard(
  Effect.gen(function* () {
    const db = yield* D1Database.Database;
    const hash = yield* ApiTokenSecret.hash(Redacted.make(token));
    const sessionId = yield* SessionToken.hash(Redacted.make(session));
    const memberHash = yield* ApiTokenSecret.hash(Redacted.make(memberToken));
    const memberSessionId = yield* SessionToken.hash(Redacted.make(memberSession));
    const member = Testing.member.id;
    yield* db.batch([
      D1Database.sql`INSERT INTO devices (id, user_id, name, kind)
        VALUES ('device-1', 'owner', 'Synthetic Zen', 'zen')`,
      D1Database.sql`INSERT INTO devices (id, user_id, name, kind)
        VALUES ('device-2', 'owner', 'Other Zen', 'zen')`,
      D1Database.sql`INSERT INTO api_tokens (id, user_id, device_id, hash)
        VALUES ('token-1', 'owner', 'device-1', ${hash})`,
      D1Database.sql`INSERT INTO links (id, user_id, url, title, type)
        VALUES ('link-1', 'owner', 'https://example.com/a', 'Economics explained', 'article')`,
      D1Database.sql`INSERT INTO sessions (id, user_id, github_login, expires_at)
        VALUES (${sessionId}, 'owner', 'example-user', '2999-01-01T00:00:00.000Z')`,
      D1Database.sql`INSERT INTO devices (id, user_id, name, kind)
        VALUES ('device-member', ${member}, 'Member Zen', 'zen')`,
      D1Database.sql`INSERT INTO api_tokens (id, user_id, device_id, hash)
        VALUES ('token-member', ${member}, 'device-member', ${memberHash})`,
      D1Database.sql`INSERT INTO links (id, user_id, url, title, type)
        VALUES ('link-member', ${member}, 'https://example.com/a', 'Economics for members',
          'article')`,
      D1Database.sql`INSERT INTO sessions (id, user_id, github_login, expires_at)
        VALUES (${memberSessionId}, ${member}, 'synthetic-member', '2999-01-01T00:00:00.000Z')`,
      D1Database.sql`INSERT INTO user_identities (provider, subject, user_id, label)
        VALUES ('github', '7001', ${member}, 'synthetic-member')`,
    ]);
  }).pipe(Effect.orDie),
).pipe(Layer.provideMerge(Testing.layerDatabase));

/** Wiring tests never reach GitHub. */
const layerNoNetwork = Layer.succeed(HttpClient.HttpClient)(
  HttpClient.make(() => Effect.die(new Error("unexpected outbound request"))),
);

const makeApp = (layer: typeof ApiLayer.layer) =>
  HttpRouter.toWebHandler(
    layer.pipe(
      Layer.provide(layerDatabase),
      Layer.provide(Testing.layerStashConfig({ webOrigin, mcpOrigin: "https://mcp.example.com" })),
      Layer.provide(Testing.layerAi()),
      Layer.provide(Testing.layerVectors),
      Layer.provide(Testing.layerBlobs),
      Layer.provide(Testing.layerGithubConfig),
      Layer.provide(layerNoNetwork),
      Layer.provide(Testing.layerEnrichmentQueue),
      Layer.provide(Testing.layerKv),
      Layer.provide(Testing.layerLinkEvents),
    ),
    { disableLogger: true },
  );

const app = makeApp(ApiLayer.layer);
/** What the Worker's `InternalApi` entrypoint serves. Its own in-memory D1. */
const internalApp = makeApp(ApiLayer.internalLayer);

afterAll(() => Promise.all([app.dispose(), internalApp.dispose()]));

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

const internalRequest = (
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: unknown,
) =>
  internalApp.handler(
    new Request(`http://localhost${path}`, {
      method,
      headers: body === undefined ? headers : { ...headers, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
const cookie = { cookie: `stash_session=${session}` };
const memberBearer = { authorization: `Bearer ${memberToken}` };
const memberCookie = { cookie: `stash_session=${memberSession}` };

// Before the suite below, which logs the owner's session out.
describe("two users", () => {
  it("serves each user their own account, links and search", async () => {
    const mine = (await (await request("GET", "/members/me", cookie)).json()) as { id: string };
    expect(mine).toMatchObject({ id: "owner", role: "owner", dailyAiQuota: null });
    const theirs = await (await request("GET", "/members/me", memberBearer)).json();
    expect(theirs).toMatchObject({
      id: Testing.member.id,
      role: "member",
      ai: { usedToday: 0, waiting: expect.any(Number) },
    });

    const ids = async (headers: Record<string, string>, path: string) =>
      JSON.stringify(await (await request("GET", path, headers)).json());
    expect(await ids(memberBearer, "/links")).toContain("link-member");
    expect(await ids(memberBearer, "/links")).not.toContain("link-1");
    expect(await ids(bearer, "/links")).not.toContain("link-member");
    expect(await ids(memberCookie, "/search?q=economics")).toContain("link-member");
    expect(await ids(memberCookie, "/search?q=economics")).not.toContain("link-1");
    expect(await ids(cookie, "/search?q=economics")).not.toContain("link-member");

    // The same URL is one link for each of them.
    expect((await request("GET", "/links/link-1", memberBearer)).status).toBe(404);
    expect((await request("GET", "/links/link-member", bearer)).status).toBe(404);
  });

  it("keeps members and invites to the owner, and opens an invite to anyone who has its link", async () => {
    for (const [method, path] of [
      ["GET", "/members"],
      ["GET", "/invites"],
      ["POST", "/invites"],
      ["DELETE", "/members/owner"],
    ] as const) {
      const response = await request(method, path, memberCookie);
      expect(response.status, `${method} ${path}`).toBe(403);
    }
    const members = (await (await request("GET", "/members", cookie)).json()) as Array<{
      id: string;
    }>;
    expect(members.map((member) => member.id)).toContain(Testing.member.id);

    const created = await request("POST", "/invites", cookie);
    expect(created.status).toBe(201);
    const invite = (await created.json()) as { id: string; token: string };
    // The list never shows the token again.
    const listed = await (await request("GET", "/invites", cookie)).text();
    expect(listed).toContain(invite.id);
    expect(listed).not.toContain(invite.token);

    expect((await request("POST", "/invites/check", {}, { token: invite.token })).status).toBe(200);
    expect((await request("DELETE", `/invites/${invite.id}`, cookie)).status).toBe(204);
    expect((await request("POST", "/invites/check", {}, { token: invite.token })).status).toBe(404);
    expect((await request("POST", "/invites/check", {}, { token: "u".repeat(43) })).status).toBe(
      404,
    );
  });
});

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
    ["GET", "/devices/activity"],
    ["POST", "/pairings"],
    ["GET", "/members/me"],
    ["GET", "/members"],
    ["GET", "/invites"],
    ["POST", "/invites"],
  ])("answers 401 to %s %s without a credential", async (method, path) => {
    const response = await request(method, path);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ _tag: "Unauthorized" });
  });

  it("routes the device flow without a credential", async () => {
    // An unknown flow is answered from KV, so GitHub is not called.
    const response = await request("POST", "/auth/device/poll", {}, { flowId: "unknown-flow" });
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({ _tag: "DeviceFlowExpired" });
  });

  it("pairs an extension: the owner approves, the extension claims without a credential", async () => {
    const code = "synthetic-wiring-pairing-code-000000000000";
    const pending = await request("POST", "/pairings/claim", {}, { code });
    expect(pending.status).toBe(404);
    const approved = await request("POST", "/pairings", cookie, { code, name: "Synthetic Zen" });
    expect(approved.status).toBe(201);
    const device = (await approved.json()) as { id: string; kind: string };
    expect(device.kind).toBe("zen");
    const again = await request("POST", "/pairings", cookie, { code, name: "Synthetic Zen" });
    expect(again.status).toBe(409);
    const claimed = await request("POST", "/pairings/claim", {}, { code });
    expect(claimed.status).toBe(201);
    expect(await claimed.json()).toMatchObject({ deviceId: device.id });
    expect((await request("POST", "/pairings/claim", {}, { code })).status).toBe(404);
  });

  it("serves the connect info with the MCP endpoint", async () => {
    const response = await request("GET", "/connect/info", cookie);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ mcpUrl: "https://mcp.example.com/mcp" });
  });

  it("serves the devices' activity", async () => {
    await request("GET", "/links", bearer);
    const response = await request("GET", "/devices/activity", cookie);
    expect(response.status).toBe(200);
    const activity = (await response.json()) as ReadonlyArray<{ deviceId: string }>;
    expect(activity).toContainEqual(
      expect.objectContaining({ deviceId: "device-1", lastSeenAt: expect.any(String) }),
    );
  });

  it("rejects an unknown bearer token", async () => {
    const response = await request("GET", "/links", { authorization: "Bearer stash_unknown" });
    expect(response.status).toBe(401);
  });

  it("serves the tokens group to a seeded bearer token", async () => {
    const response = await request("GET", "/tokens", bearer);
    expect(response.status).toBe(200);
    expect(await response.json()).toContainEqual(
      expect.objectContaining({ id: "token-1", deviceId: "device-1", revokedAt: null }),
    );
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

  it("serves the catch-up filters of the links group: ids and updatedSince", async () => {
    const byId = await request("GET", "/links?ids=link-1,link-missing", bearer);
    expect(byId.status).toBe(200);
    const [link] = ((await byId.json()) as { items: Array<{ id: string; updatedAt: string }> })
      .items;
    expect(link).toMatchObject({ id: "link-1" });
    // The migration's trigger stamped the seeded link.
    expect(link!.updatedAt).toMatch(/^\d{4}-\d\d-\d\dT.*Z$/);

    const since = (at: string) =>
      request("GET", `/links?updatedSince=${encodeURIComponent(at)}`, bearer).then(
        async (response) => ((await response.json()) as { items: Array<{ id: string }> }).items,
      );
    expect((await since(link!.updatedAt)).map((item) => item.id)).toContain("link-1");
    expect(await since("2999-01-01T00:00:00.000Z")).toEqual([]);
    expect((await request("GET", "/links?updatedSince=yesterday", bearer)).status).toBe(400);
  });

  it("guards the live stream: 401 without a credential, 426 to a plain request", async () => {
    const anonymous = await request("GET", "/events");
    expect(anonymous.status).toBe(401);
    const plain = await request("GET", "/events", bearer);
    expect(plain.status).toBe(426);
    expect(await plain.json()).toMatchObject({ _tag: "UpgradeRequired" });
  });

  it("hands an authenticated WebSocket upgrade to the user's LinkEvents object", async () => {
    const opened: Array<{ user: string; request: Request }> = [];
    const namespace: EventsUpgrade.Namespace = {
      idFromName: (user) => user,
      get: (user) => ({
        fetch: async (request) => {
          opened.push({ user, request });
          // Node cannot build a 101: any answer of the object passes through as it is.
          return new Response("socket", { status: 200 });
        },
      }),
    };
    const upgrade = (path: string, headers: Record<string, string>, method = "GET") =>
      EventsUpgrade.handleEvents(
        new Request(`http://localhost${path}`, {
          method,
          headers: { ...headers, upgrade: "websocket", connection: "Upgrade" },
        }),
        app.handler,
        namespace,
        webOrigin,
      );

    // No credential, a bad one: the router's 401, and the object is never reached.
    expect((await upgrade("/events", {}))?.status).toBe(401);
    expect((await upgrade("/events", { authorization: "Bearer nope" }))?.status).toBe(401);
    expect(opened).toEqual([]);

    // A device token and the session cookie both open the stream of their user, and of no other:
    // the object is named by the user's id, which the caller cannot choose.
    for (const credential of [bearer, cookie, memberBearer, memberCookie]) {
      const response = await upgrade("/events", credential);
      expect(await response?.text()).toBe("socket");
    }
    expect(opened.map(({ user }) => user)).toEqual([
      LinkEvents.objectName("owner"),
      LinkEvents.objectName("owner"),
      LinkEvents.objectName(Testing.member.id),
      LinkEvents.objectName(Testing.member.id),
    ]);
    expect(LinkEvents.objectName("owner")).not.toBe(LinkEvents.objectName(Testing.member.id));
    expect(opened[0]!.request.headers.get("upgrade")).toBe("websocket");

    // The cookie opens a stream only from the web app's own origin (a browser always names it):
    // a page of another site is refused before anything else. A token needs no origin.
    const before = opened.length;
    expect(
      (await upgrade("/events", { ...cookie, origin: "https://evil.example.com" }))?.status,
    ).toBe(403);
    expect(opened.length).toBe(before);
    expect(await (await upgrade("/events", { ...cookie, origin: webOrigin }))?.text()).toBe(
      "socket",
    );
    expect(
      await (await upgrade("/events", { ...bearer, origin: "https://other.example.com" }))?.text(),
    ).toBe("socket");

    // Everything else stays with the router.
    expect(await upgrade("/links", bearer)).toBeUndefined();
    expect(await upgrade("/events", bearer, "POST")).toBeUndefined();
    expect(
      await EventsUpgrade.handleEvents(
        new Request("http://localhost/events", { headers: bearer }),
        app.handler,
        namespace,
        webOrigin,
      ),
    ).toBeUndefined();

    // A Worker deployed without the binding says so, after the same check.
    const unbound = await EventsUpgrade.handleEvents(
      new Request("http://localhost/events", { headers: { ...bearer, upgrade: "websocket" } }),
      app.handler,
      undefined,
      webOrigin,
    );
    expect(unbound?.status).toBe(503);
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
    // Another user's device does not exist for this one.
    expect((await request("PUT", "/devices/device-member/tabs", bearer, tabs)).status).toBe(404);
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

  it("authenticates a session cookie and logs it out", async () => {
    const me = await request("GET", "/auth/me", cookie);
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({ kind: "user", login: "example-user" });
    expect((await request("GET", "/tokens", cookie)).status).toBe(200);
    expect(await (await request("GET", "/auth/me", memberCookie)).json()).toEqual({
      kind: "user",
      login: "synthetic-member",
    });
    expect(await (await request("GET", "/auth/me", bearer)).json()).toEqual({
      kind: "device",
      deviceId: "device-1",
    });

    const logout = await request("POST", "/auth/logout", cookie);
    expect(logout.status).toBe(204);
    expect(logout.headers.getSetCookie()).toEqual([expect.stringMatching(/^stash_session=;/)]);
    expect((await request("GET", "/auth/me", cookie)).status).toBe(401);
  });

  it("has no internal routes on the public fetch, with or without credentials", async () => {
    for (const headers of [{}, bearer, cookie]) {
      const response = await request("POST", "/internal/mcp-tokens", headers, {
        login: "example-user",
        githubId: "1001",
      });
      expect(response.status).toBe(404);
    }
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

describe("InternalApi entrypoint", () => {
  it("mints a Claude (MCP) user token that acts as the user until it is revoked", async () => {
    const minted = await internalRequest(
      "POST",
      "/internal/mcp-tokens",
      {},
      { login: "Example-User", githubId: "1001" },
    );
    expect(minted.status).toBe(201);
    const created = (await minted.json()) as { id: string; name: string; token: string };
    expect(created).toMatchObject({ deviceId: null, name: "Claude (MCP)", revokedAt: null });

    const asMcp = { authorization: `Bearer ${created.token}` };
    const me = await internalRequest("GET", "/members/me", asMcp);
    expect(await me.json()).toMatchObject({ id: "owner", role: "owner" });

    const listed = await internalRequest("GET", "/tokens", cookie);
    expect(await listed.json()).toContainEqual(
      expect.objectContaining({ id: created.id, deviceId: null, name: "Claude (MCP)" }),
    );

    const saved = await internalRequest("POST", "/links", asMcp, { url: "https://example.com/m" });
    expect(saved.status).toBe(201);

    expect((await internalRequest("DELETE", `/tokens/${created.id}`, cookie)).status).toBe(204);
    const revoked = await internalRequest("GET", "/links", asMcp);
    expect(revoked.status).toBe(401);
  });

  it("mints a member's token by their GitHub id, and it acts as that member only", async () => {
    const minted = await internalRequest(
      "POST",
      "/internal/mcp-tokens",
      {},
      // The login was renamed since they signed up: the id decides.
      { login: "renamed-member", githubId: "7001" },
    );
    expect(minted.status).toBe(201);
    const { token: mcpToken } = (await minted.json()) as { token: string };
    const asMcp = { authorization: `Bearer ${mcpToken}` };
    expect(await (await internalRequest("GET", "/members/me", asMcp)).json()).toMatchObject({
      id: Testing.member.id,
    });
    const links = await (await internalRequest("GET", "/links", asMcp)).text();
    expect(links).toContain("link-member");
    expect(links).not.toContain("link-1");
    // The owner does not see the member's token in Settings.
    expect(await (await internalRequest("GET", "/tokens", cookie)).text()).not.toContain(
      "token-member",
    );
  });

  it("refuses an account that has no Stash user, whatever login it names", async () => {
    for (const login of ["synthetic-stranger", "synthetic-member"]) {
      const response = await internalRequest(
        "POST",
        "/internal/mcp-tokens",
        {},
        { login, githubId: "9999" },
      );
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ _tag: "LoginNotAllowed" });
    }
  });

  it("still serves the public StashApi", async () => {
    expect((await internalRequest("GET", "/tokens", bearer)).status).toBe(200);
  });
});
