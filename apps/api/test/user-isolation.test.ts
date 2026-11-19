// No endpoint lets one user read or change another user's data (#177).
//
// The list of endpoints is not written here: it is read from the contracts `StashApi`, so an
// endpoint added later is in this test the day it is added, and the test fails until it says how
// that endpoint could reach another user (`cases`). Each endpoint is then called on the composed
// API (the same layer the Worker serves) by an attacker, with the victim's ids wherever the
// endpoint takes one, with each credential the attacker has (a web session, a device token), and:
//
// - an endpoint that names a resource answers exactly what it answers for an id that does not
//   exist (404), or 403 where the caller may never use it at all;
// - no answer contains anything of the victim;
// - nothing of the victim changed, in D1, in the vector index, in R2 or on their live stream.
//
// Victims are another member and the owner. Synthetic data only.
import * as ApiTokenSecret from "@stash/backend-auth/api-token-secret";
import * as SessionToken from "@stash/backend-auth/session-token";
import * as Blobs from "@stash/backend-platform/blobs";
import * as D1Database from "@stash/backend-platform/d1-database";
import * as Testing from "@stash/backend-platform/testing";
import * as Vectors from "@stash/backend-platform/vectors";
import * as SecretHash from "@stash/backend-users/secret-hash";
import * as Api from "@stash/contracts-api/api";
import * as Security from "@stash/contracts-api/security";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as HttpRouter from "effect/http/HttpRouter";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Redacted from "effect/Redacted";
import { describe, expect, it } from "vitest";
import * as ApiLayer from "../src/api-layer.ts";

type User = Security.CurrentUser["Service"];

/** What is seeded for a user. Every id and every text of theirs carries their `mark`. */
const world = (user: User) => {
  const mark = `zq${user.id.replaceAll("-", "")}`;
  return {
    user,
    mark,
    link: `${mark}-link`,
    device: `${mark}-device`,
    command: `${mark}-command`,
    token: `${mark}-token`,
    invite: `${mark}-invite`,
    inviteToken: `${mark}InviteToken`.padEnd(43, "x"),
    pairingCode: `${mark}PairingCode`.padEnd(43, "x"),
    bearer: `stash_${mark}-synthetic-secret`,
    session: `${mark}-synthetic-session`,
    /** One page both users saved: the same URL is a separate link for each. */
    sharedUrl: "https://example.com/shared-page",
  };
};
type World = ReturnType<typeof world>;

const seed = (w: World) =>
  Effect.gen(function* () {
    const db = yield* D1Database.Database;
    const hash = yield* ApiTokenSecret.hash(Redacted.make(w.bearer));
    const sessionId = yield* SessionToken.hash(Redacted.make(w.session));
    const u = w.user.id;
    yield* db.batch([
      D1Database.sql`INSERT INTO devices (id, user_id, name, kind, tabs_taken_at)
        VALUES (${w.device}, ${u}, ${`${w.mark} Zen`}, 'zen', '2026-01-01T00:00:00.000Z')`,
      D1Database.sql`INSERT INTO api_tokens (id, user_id, device_id, hash)
        VALUES (${w.token}, ${u}, ${w.device}, ${hash})`,
      D1Database.sql`INSERT INTO sessions (id, user_id, github_login, expires_at)
        VALUES (${sessionId}, ${u}, ${u === "owner" ? "example-user" : `${w.mark}-login`},
          '2999-01-01T00:00:00.000Z')`,
      D1Database.sql`INSERT INTO links (id, user_id, url, canonical_url, title, summary, text, type,
          source_device_id, enriched_at, vector_version)
        VALUES (${w.link}, ${u}, ${w.sharedUrl}, ${w.sharedUrl}, ${`Economics ${w.mark}`},
          ${`A summary about economics, ${w.mark}.`}, ${`Private text ${w.mark} economics`},
          'article', ${w.device}, '2026-01-01T00:01:00.000Z', 1)`,
      D1Database.sql`INSERT OR IGNORE INTO tags (name) VALUES (${`${w.mark}-tag`})`,
      D1Database.sql`INSERT INTO link_tags (link_id, tag_id, user_id)
        SELECT ${w.link}, id, ${u} FROM tags WHERE name = ${`${w.mark}-tag`}`,
      D1Database.sql`INSERT INTO open_tabs (user_id, device_id, url, title, last_seen_at)
        VALUES (${u}, ${w.device}, ${`https://example.com/${w.mark}-tab`}, ${`${w.mark} tab`},
          '2026-01-01T00:00:00.000Z')`,
      D1Database.sql`INSERT INTO commands (id, user_id, device_id, kind, payload)
        VALUES (${w.command}, ${u}, ${w.device}, 'close-tab',
          ${JSON.stringify({ kind: "close-tab", url: `https://example.com/${w.mark}-tab` })})`,
      D1Database.sql`INSERT INTO digests (user_id, period_start, period_end, generated_at, content)
        VALUES (${u}, '2026-01-05T00:00:00.000Z', '2026-01-12T00:00:00.000Z',
          '2026-01-12T06:00:00.000Z', ${JSON.stringify({
            periodStart: "2026-01-05T00:00:00.000Z",
            periodEnd: "2026-01-12T00:00:00.000Z",
            generatedAt: "2026-01-12T06:00:00.000Z",
            totals: { saved: 1, seen: 0, done: 0, archived: 0 },
            topTags: [{ name: `${w.mark}-tag`, count: 1 }],
            topTypes: [{ type: "article", count: 1 }],
            highlights: [
              { linkId: w.link, url: w.sharedUrl, title: `Economics ${w.mark}`, summary: null },
            ],
          })})`,
      // A pairing they approved and their extension has not claimed yet.
      D1Database.sql`INSERT INTO device_pairings (code_hash, user_id, device_id, expires_at)
        VALUES (${yield* SecretHash.hash(w.pairingCode)}, ${u}, ${w.device},
          '2999-01-01T00:00:00.000Z')`,
      D1Database.sql`INSERT INTO ai_usage (user_id, day, links) VALUES (${u}, '2026-01-01', 7)`,
    ]);
    if (w.user.role === "owner") {
      yield* db.run(
        D1Database.sql`INSERT INTO invites (id, token_hash, created_by, expires_at)
          VALUES (${w.invite}, ${yield* SecretHash.hash(w.inviteToken)}, ${u},
            '2999-01-01T00:00:00.000Z')`,
      );
    }
    yield* Vectors.Vectors.use((vectors) =>
      vectors.upsert([
        {
          id: w.link,
          values: Testing.fakeEmbedding(`Economics ${w.mark}`),
          metadata: { [Vectors.userIdKey]: u },
        },
      ]),
    );
    yield* Blobs.Blobs.use((blobs) => blobs.put(Blobs.linkTextKey(w.link), `text ${w.mark}`));
  });

/** Everything stored for a user, to compare before and after a call. */
const snapshot = (w: World) =>
  Effect.gen(function* () {
    const db = yield* D1Database.Database;
    const tables = [
      "devices",
      "links",
      "link_tags",
      "open_tabs",
      "commands",
      "sessions",
      "device_pairings",
      "api_tokens",
      "digests",
      "user_identities",
      "ai_usage",
    ];
    const rows: Record<string, unknown> = {};
    for (const table of tables) {
      // `last_used_at` is the one column a user's own later request changes; nobody else's does.
      rows[table] = yield* db.all(
        D1Database.statement(`SELECT * FROM ${table} WHERE user_id = ? ORDER BY 1, 2`, w.user.id),
      );
    }
    rows["users"] = yield* db.all(D1Database.sql`SELECT * FROM users WHERE id = ${w.user.id}`);
    rows["invites"] = yield* db.all(
      D1Database.sql`SELECT * FROM invites WHERE created_by = ${w.user.id} ORDER BY id`,
    );
    rows["fts"] = yield* db.all(
      D1Database.sql`SELECT rowid, user_id FROM links_fts WHERE links_fts MATCH ${w.mark}`,
    );
    rows["vectors"] = yield* Vectors.Vectors.use((vectors) => vectors.getByIds([w.link]));
    rows["blob"] = yield* Blobs.Blobs.use((blobs) => blobs.getText(Blobs.linkTextKey(w.link)));
    rows["events"] = yield* Testing.TestLinkEvents.use((events) => events.publishedTo(w.user.id));
    rows["closed"] = (yield* Testing.TestLinkEvents.use((events) => events.closed)).includes(
      w.user.id,
    );
    return rows;
  });

/** GitHub is never reached: the device flow gets a 404 from it. */
const layerNoGithub = Layer.succeed(HttpClient.HttpClient)(
  HttpClient.make((request) =>
    Effect.succeed(HttpClientResponse.fromWeb(request, new Response("", { status: 404 }))),
  ),
);

const layerPlatform = Layer.mergeAll(
  Testing.layerDatabase,
  Testing.layerStashConfig({
    webOrigin: "https://web.example.com",
    mcpOrigin: "https://mcp.example.com",
  }),
  Testing.layerAi(),
  Testing.layerVectors,
  Testing.layerBlobs,
  Testing.layerGithubConfig,
  layerNoGithub,
  Testing.layerEnrichmentQueue,
  Testing.layerKv,
  Testing.layerLinkEvents,
);

/** A fresh composed API over fresh stores with the attacker's and the victim's data. */
const makeApp = async (attacker: World, victim: World) => {
  const platform = ManagedRuntime.make(layerPlatform);
  const context = await platform.context();
  await platform.runPromise(Effect.andThen(seed(attacker), seed(victim)));
  const app = HttpRouter.toWebHandler(
    ApiLayer.layer.pipe(Layer.provide(Layer.succeedContext(context))),
    { disableLogger: true },
  );
  return {
    handler: app.handler,
    snapshot: (w: World) => platform.runPromise(snapshot(w)),
    dispose: async () => {
      await app.dispose();
      await platform.dispose();
    },
  };
};

interface Input {
  /** Path parameters, by name. */
  readonly params?: Record<string, string>;
  readonly query?: Record<string, string>;
  readonly body?: unknown;
}

type Case =
  /**
   * The endpoint names a resource. Called with the victim's id it must answer `status`: 404, as
   * for an id that does not exist, or 403 where the attacker may never call it (`also`, for a
   * credential that is refused before the resource is looked at).
   */
  | {
      readonly kind: "resource";
      readonly input: (victim: World, attacker: World) => Input;
      readonly status: 404 | 403;
      readonly also?: ReadonlyArray<number>;
    }
  /**
   * The endpoint takes no id of anyone: it works on the caller's own data. It is called (with
   * input that would match the victim's data if the scoping were missing) and must succeed
   * (`status`) without a trace of the victim.
   */
  | {
      readonly kind: "own";
      readonly input?: (victim: World, attacker: World) => Input;
      readonly status: ReadonlyArray<number>;
    }
  /**
   * The endpoint has no user at all (no `Authorization`): it is called without a credential,
   * with the victim's secret where it takes one.
   */
  | {
      readonly kind: "open";
      readonly input: (victim: World, attacker: World) => Input;
      readonly status: ReadonlyArray<number>;
      /** What the open call may change of the victim: only what the secret it was given is for. */
      readonly changes?: ReadonlyArray<string>;
    };

const tabs = { takenAt: "2026-02-01T00:00:00.000Z", tabs: [] };

// One entry per endpoint of `StashApi`. The test below fails for an endpoint without one.
const cases: Record<string, Case> = {
  // links: the victim's link id, and the URL both saved.
  "links.save": {
    kind: "own",
    input: (victim) => ({ body: { url: victim.sharedUrl, tags: [`${victim.mark}-tag`] } }),
    // The attacker has that URL already: their own link is answered, never the victim's.
    status: [200, 201],
  },
  "links.saveBatch": {
    kind: "own",
    input: (victim) => ({
      body: { links: [{ url: victim.sharedUrl }, { url: "https://example.com/another" }] },
    }),
    status: [201],
  },
  "links.list": {
    kind: "own",
    input: (victim) => ({ query: { ids: victim.link, limit: "100" } }),
    status: [200],
  },
  "links.get": { kind: "resource", input: (v) => ({ params: { id: v.link } }), status: 404 },
  "links.update": {
    kind: "resource",
    input: (v) => ({ params: { id: v.link }, body: { status: "archived", tags: ["taken"] } }),
    status: 404,
  },
  "links.remove": { kind: "resource", input: (v) => ({ params: { id: v.link } }), status: 404 },
  "search.search": {
    kind: "own",
    input: (victim) => ({ query: { q: `economics ${victim.mark}`, limit: "50" } }),
    status: [200],
  },

  // tabs and devices: the victim's device and command.
  "tabs.report": {
    kind: "resource",
    input: (v) => ({ params: { id: v.device }, body: tabs }),
    status: 404,
  },
  "tabs.list": { kind: "own", status: [200] },
  "tabs.archive": {
    kind: "resource",
    input: (v) => ({
      body: { deviceId: v.device, url: `https://example.com/${v.mark}-tab` },
    }),
    status: 404,
  },
  "devices.list": { kind: "own", status: [200] },
  "devices.activity": { kind: "own", status: [200] },
  "devices.register": {
    kind: "own",
    input: () => ({ body: { name: "Attacker phone", kind: "ios" } }),
    status: [201],
  },
  "devices.sendCommand": {
    kind: "resource",
    input: (v) => ({
      params: { id: v.device },
      body: { kind: "close-tab", url: `https://example.com/${v.mark}-tab` },
    }),
    status: 404,
    // A device token never sends commands, whoever the device belongs to.
    also: [403],
  },
  "devices.listCommands": {
    kind: "resource",
    input: (v) => ({ params: { id: v.device } }),
    status: 404,
  },
  "devices.ackCommand": {
    kind: "resource",
    input: (v) => ({ params: { id: v.command }, body: { status: "done" } }),
    status: 404,
  },

  // tokens: a token for the victim's device, and the victim's token.
  "tokens.list": { kind: "own", status: [200] },
  "tokens.create": {
    kind: "resource",
    input: (v) => ({ body: { deviceId: v.device } }),
    status: 404,
    also: [403],
  },
  "tokens.revoke": {
    kind: "resource",
    input: (v) => ({ params: { id: v.token } }),
    status: 404,
    also: [403],
  },

  // auth: who the caller is, and the login, which has no user yet.
  "auth.me": { kind: "own", status: [200] },
  "auth.logout": { kind: "own", status: [204] },
  "auth.deviceStart": { kind: "open", input: () => ({}), status: [200, 429, 500, 502, 503] },
  "auth.devicePoll": {
    kind: "open",
    input: (v) => ({ body: { flowId: `${v.mark}-flow` } }),
    status: [410],
  },

  "digest.latest": { kind: "own", status: [200] },

  // pairings: approving registers a device of the caller; claiming takes a code, and a code is a
  // secret only the extension that made it knows.
  "pairings.approve": {
    kind: "own",
    input: (_, attacker) => ({
      body: { code: `${attacker.mark}NewCode`.padEnd(43, "y"), name: "Attacker Zen" },
    }),
    status: [201],
  },
  "pairings.claim": {
    kind: "open",
    // A code nobody approved. (The victim's own code would be the victim's extension claiming.)
    input: (_, attacker) => ({ body: { code: `${attacker.mark}Unknown`.padEnd(43, "y") } }),
    status: [404],
  },

  "connect.info": { kind: "own", status: [200] },
  // A plain request is told to upgrade; `worker.test.ts` checks whose object an upgrade reaches.
  "events.stream": { kind: "own", status: [426] },

  // members and invites: only the owner manages them.
  "members.me": { kind: "own", status: [200] },
  "members.list": { kind: "resource", input: () => ({}), status: 403 },
  "members.remove": {
    kind: "resource",
    input: (v) => ({ params: { id: v.user.id } }),
    status: 403,
  },
  "invites.list": { kind: "resource", input: () => ({}), status: 403 },
  "invites.create": { kind: "resource", input: () => ({}), status: 403 },
  "invites.revoke": {
    kind: "resource",
    input: (v) => ({ params: { id: v.invite } }),
    status: 403,
  },
  "invites.check": {
    kind: "open",
    // A token that is not an invite. Knowing a real one is being invited.
    input: (_, attacker) => ({ body: { token: `${attacker.mark}NotAnInvite`.padEnd(43, "y") } }),
    status: [404],
  },
};

// The endpoints, read from the definition.
interface EndpointShape {
  readonly method: string;
  readonly path: string;
  readonly middlewares: ReadonlySet<unknown>;
}
const endpoints = Object.entries(
  Api.StashApi.groups as unknown as Record<
    string,
    { readonly endpoints: Record<string, EndpointShape> }
  >,
).flatMap(([group, { endpoints: byName }]) =>
  Object.entries(byName).map(([name, endpoint]) => ({
    key: `${group}.${name}`,
    method: endpoint.method,
    path: endpoint.path,
    guarded: endpoint.middlewares.has(Security.Authorization),
  })),
);

const build = (endpoint: (typeof endpoints)[number], input: Input, headers: HeadersInit) => {
  const params = { ...input.params };
  const path = endpoint.path.replaceAll(/:(\w+)/g, (_, name: string) => {
    const value = params[name];
    if (value === undefined) throw new Error(`${endpoint.key}: no value for :${name}`);
    delete params[name];
    return encodeURIComponent(value);
  });
  if (Object.keys(params).length > 0) {
    throw new Error(`${endpoint.key}: ${endpoint.path} has no :${Object.keys(params).join(", :")}`);
  }
  const query = new URLSearchParams(input.query).toString();
  return new Request(`http://localhost${path}${query === "" ? "" : `?${query}`}`, {
    method: endpoint.method,
    headers:
      input.body === undefined ? headers : { ...headers, "content-type": "application/json" },
    ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
  });
};

/** What may never appear in an answer to someone else: the victim's mark, on every id and text. */
const traces = (victim: World) =>
  victim.user.role === "owner" ? [victim.mark] : [victim.mark, victim.user.id];

/** Every string the caller sent, longest first. */
const sent = (input: Input): ReadonlyArray<string> => {
  const found: Array<string> = [];
  const walk = (value: unknown): void => {
    if (typeof value === "string") found.push(value);
    else if (value !== null && typeof value === "object") Object.values(value).forEach(walk);
  };
  walk([input.params, input.query, input.body]);
  return found.sort((a, b) => b.length - a.length);
};

const attacker = world(Testing.member);
const victims = [world(Testing.otherMember), world(Testing.owner)];

describe("isolation between users, for every endpoint of StashApi", () => {
  it("knows every endpoint, and nothing that is not one", () => {
    expect(endpoints.length).toBeGreaterThan(30);
    expect(Object.keys(cases).sort()).toEqual(endpoints.map((endpoint) => endpoint.key).sort());
  });

  it("treats an endpoint as open exactly when the definition leaves it unguarded", () => {
    for (const endpoint of endpoints) {
      expect(cases[endpoint.key]?.kind === "open", endpoint.key).toBe(!endpoint.guarded);
    }
  });

  // Requires a path parameter to be the victim's wherever there is one: an endpoint with `:id`
  // cannot be declared "own".
  it("calls every endpoint that takes an id with the victim's id", () => {
    for (const endpoint of endpoints) {
      const found = cases[endpoint.key];
      if (!endpoint.path.includes(":") || found === undefined) continue;
      expect(found.kind, endpoint.key).toBe("resource");
      const input = found.input?.(victims[0]!, attacker) ?? {};
      const values = Object.values(input.params ?? {});
      expect(values.length, endpoint.key).toBeGreaterThan(0);
      for (const value of values) {
        expect(
          value.includes(victims[0]!.mark) || value === victims[0]!.user.id,
          `${endpoint.key}: ${value}`,
        ).toBe(true);
      }
    }
  });

  describe.each(victims.map((victim) => [victim.user.role, victim] as const))(
    "a member against the %s",
    (_, victim) => {
      const credentials = {
        session: { cookie: `stash_session=${attacker.session}` },
        "device token": { authorization: `Bearer ${attacker.bearer}` },
      };

      it.each(endpoints.map((endpoint) => [endpoint.key, endpoint] as const))(
        "%s",
        async (key, endpoint) => {
          const found = cases[key];
          if (found === undefined) throw new Error(`${key} has no isolation case`);
          const input = found.input?.(victim, attacker) ?? {};
          const tries =
            found.kind === "open" ? { "no credential": {} } : (credentials as Record<string, {}>);

          for (const [credential, headers] of Object.entries(tries)) {
            // Fresh stores for every call: no call depends on what another one did.
            const app = await makeApp(attacker, victim);
            try {
              const before = await app.snapshot(victim);
              const response = await app.handler(build(endpoint, input, headers));
              const text = await response.text();
              const label = `${key} with ${credential}: ${response.status} ${text.slice(0, 200)}`;

              const allowed =
                found.kind === "resource" ? [found.status, ...(found.also ?? [])] : found.status;
              expect(allowed, label).toContain(response.status);
              if (found.kind === "resource" && credential === "session") {
                // The web session is the credential that may do everything a user can: for it
                // the answer is the one for a thing that does not exist, never a softer refusal.
                expect(response.status, label).toBe(found.status);
              }
              // An error may repeat the id it was asked for. Anything else of the victim is a leak.
              const answered = sent(input).reduce(
                (rest, value) => rest.replaceAll(value, ""),
                text,
              );
              for (const trace of traces(victim)) expect(answered, label).not.toContain(trace);
              expect(await app.snapshot(victim), label).toEqual(before);
            } finally {
              await app.dispose();
            }
          }
        },
      );

      it("answers a missing id exactly as it answers the victim's", async () => {
        // 404 must not tell "exists, but is not yours" from "does not exist".
        for (const endpoint of endpoints) {
          const found = cases[endpoint.key];
          if (found?.kind !== "resource" || found.status !== 404) continue;
          const ghost = world({ id: "user-ghost" as User["id"], role: "member" });
          const app = await makeApp(attacker, victim);
          try {
            const answers = [];
            for (const target of [victim, ghost]) {
              const response = await app.handler(
                build(endpoint, found.input(target, attacker), credentials.session),
              );
              const body = (await response.text()).replaceAll(target.mark, "<mark>");
              answers.push({ status: response.status, body });
            }
            expect(answers[0], endpoint.key).toEqual(answers[1]);
          } finally {
            await app.dispose();
          }
        }
      });
    },
  );

  it("the attacker's own calls do work: the checks above are not passing on errors", async () => {
    const app = await makeApp(attacker, victims[0]!);
    try {
      const headers = { cookie: `stash_session=${attacker.session}` };
      const get = async (path: string) =>
        (await app.handler(new Request(`http://localhost${path}`, { headers }))).text();
      expect(await get(`/links/${attacker.link}`)).toContain(attacker.mark);
      expect(await get("/links")).toContain(attacker.link);
      expect(await get(`/search?q=economics`)).toContain(attacker.link);
      expect(await get("/tabs")).toContain(`${attacker.mark}-tab`);
      expect(await get("/devices")).toContain(attacker.device);
      expect(await get(`/devices/${attacker.device}/commands`)).toContain(attacker.command);
      expect(await get("/tokens")).toContain(attacker.token);
      expect(await get("/digest/latest")).toContain(`${attacker.mark}-tag`);
    } finally {
      await app.dispose();
    }
  });
});
