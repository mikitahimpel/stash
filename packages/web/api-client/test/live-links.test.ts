import { afterEach, describe, expect, it } from "@effect/vitest";
import * as Link from "@stash/contracts-domain/link";
import * as PlatformTesting from "@stash/web-platform/testing";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import * as Context from "effect/Context";
import * as Scope from "effect/Scope";
import * as ApiAtoms from "../src/api-atoms.ts";
import * as LinkPatches from "../src/link-patches.ts";
import * as LiveLinks from "../src/live-links.ts";
import * as Testing from "../src/testing.ts";
import * as Fixtures from "./fixtures.ts";

const tick = (millis = 0) => new Promise((resolve) => setTimeout(resolve, millis));

// Short waits, so a reconnect and a poll take milliseconds.
const timings: LiveLinks.Timings = {
  reconnect: { firstMillis: 20, maxMillis: 40 },
  poll: { firstMillis: 30, maxMillis: 60 },
};

const t0 = "2026-01-01T00:00:00.000Z";
const t1 = "2026-01-01T00:00:05.000Z";
const t2 = "2026-01-01T00:00:09.000Z";

const pendingLink = (id: string) => ({ ...Fixtures.link(id), updatedAt: t0 });
const enrichedLink = (id: string, at: string) => ({
  ...Fixtures.link(id),
  summary: `Summary of ${id}.`,
  enrichedAt: at,
  updatedAt: at,
});
const ready = (at: string) => JSON.stringify({ type: "stream.ready", at });
const updated = (id: string, at: string) =>
  JSON.stringify({ type: "link.updated", at, link: enrichedLink(id, at) });

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/**
 * An app with a stub api whose `GET /links` is counted by its query, an in-memory stream and
 * visibility, and the feed of three links (`a` and `b` pending, `c` enriched) on screen.
 */
const setup = async (
  options: { readonly reachable?: boolean; readonly connect?: boolean } = {},
) => {
  const scope = Effect.runSync(Scope.make());
  const platform = await Effect.runPromise(
    Layer.buildWithScope(
      Layer.mergeAll(
        PlatformTesting.layerLiveSocket({ reachable: options.reachable ?? true }),
        PlatformTesting.layerVisibility(),
      ),
      scope,
    ),
  );
  const server = Context.get(platform, PlatformTesting.TestLiveSocket);
  const visibility = Context.get(platform, PlatformTesting.TestVisibility);

  const asked: Array<Record<string, string>> = [];
  // What the api holds: the catch-up filters answer from it.
  const stored = new Map<string, ReturnType<typeof enrichedLink>>();
  const registry: AtomRegistry.AtomRegistry = Testing.makeRegistry(
    {
      "GET /links": (request) => {
        const query = Object.fromEntries(
          [...request.urlParams].map(([key, value]) => [key, String(value)] as const),
        );
        asked.push(query);
        if (query["ids"] !== undefined) {
          const ids = query["ids"].split(",");
          return Testing.json({
            items: [...stored.values()].filter((link) => ids.includes(link.id)),
            nextCursor: null,
          });
        }
        if (query["updatedSince"] !== undefined) {
          const since = query["updatedSince"];
          return Testing.json({
            items: [...stored.values()].filter((link) => link.updatedAt >= since),
            nextCursor: null,
          });
        }
        return Testing.json({
          items: [pendingLink("a"), pendingLink("b"), enrichedLink("c", t0)],
          nextCursor: null,
        });
      },
    },
    {
      initialValues: [
        [LiveLinks.layer, Layer.succeedContext(platform)],
        [LiveLinks.timings, timings],
      ],
    },
  );
  const feed = ApiAtoms.pages(["links"], (client) => client.links.list({ query: {} }));
  const leaveFeed = registry.mount(feed);
  await expect.poll(() => AsyncResult.isSuccess(registry.get(feed))).toBe(true);
  // The page's own background refresh is over before the stream starts.
  await tick(10);
  const feedRequests = () =>
    asked.filter((q) => q["ids"] === undefined && q["updatedSince"] === undefined).length;
  const loads = feedRequests();

  const summaries = () => {
    const result = registry.get(feed);
    return AsyncResult.isSuccess(result)
      ? Object.fromEntries(result.value.items.map((link) => [link.id, link.summary]))
      : {};
  };
  const run = <A>(effect: Effect.Effect<A>) => Effect.runPromise(effect);
  const open = () => run(server.open);

  if (options.connect !== false) {
    cleanups.push(registry.mount(LiveLinks.connection));
    if (options.reachable !== false) await expect.poll(open).toBe(1);
  }
  cleanups.push(() => {
    leaveFeed();
    registry.dispose();
    return Effect.runPromise(Scope.close(scope, Exit.void));
  });
  return {
    registry,
    server,
    visibility,
    asked,
    stored,
    summaries,
    run,
    open,
    /** How often the feed itself was asked for again since it loaded. */
    reloads: () => feedRequests() - loads,
    /** The catch-up and fallback requests so far. */
    extra: () => asked.filter((q) => q["ids"] !== undefined || q["updatedSince"] !== undefined),
  };
};

describe("LiveLinks.connection", () => {
  it("opens one stream to the api's /events", async () => {
    const app = await setup();
    // The api's base address (a synthetic one in this package's tests) plus `/events`.
    expect(LiveLinks.url).toMatch(/\/events$/);
    expect(await app.run(app.server.opened)).toEqual([LiveLinks.url]);
  });

  it("asks once for what is pending when the first stream opens", async () => {
    const app = await setup();
    // `a` was enriched between the feed's load and the stream: no event will ever say so.
    app.stored.set("a", enrichedLink("a", t1));
    await app.run(app.server.send(ready(t1)));
    await expect.poll(() => app.summaries()["a"]).toBe("Summary of a.");
    await tick(100);
    expect(app.extra()).toEqual([{ ids: "a,b", limit: "100" }]);
  });

  it("turns a pending row into the enriched link on link.updated, without a request", async () => {
    const app = await setup();
    await app.run(app.server.send(ready(t0)));
    await tick(10);
    const before = app.asked.length;

    await app.run(app.server.send(updated("a", t1)));
    await expect.poll(() => app.summaries()["a"]).toBe("Summary of a.");
    expect(app.summaries()).toEqual({ a: "Summary of a.", b: null, c: "Summary of c." });
    await tick(20);
    // Patched in place: the feed was not asked for again, and nothing else was either.
    expect(app.reloads()).toBe(0);
    expect(app.asked.length).toBe(before);
  });

  it("takes a deleted link out of the list, and ignores what it cannot read", async () => {
    const app = await setup();
    await app.run(app.server.send("not json"));
    await app.run(app.server.send(JSON.stringify({ type: "link.exploded", at: t1 })));
    await app.run(
      app.server.send(JSON.stringify({ type: "link.deleted", at: t1, id: Link.LinkId.make("b") })),
    );
    await expect.poll(() => Object.keys(app.summaries())).toEqual(["a", "c"]);
    expect(app.reloads()).toBe(0);
  });

  it("opens the stream again after it drops, and catches up from the last event", async () => {
    const app = await setup();
    await app.run(app.server.send(ready(t0)));
    await app.run(app.server.send(updated("a", t1)));
    await expect.poll(() => app.summaries()["a"]).toBe("Summary of a.");

    // While the stream is down, `b` is enriched: its event is lost.
    await app.run(app.server.drop());
    app.stored.set("b", enrichedLink("b", t2));
    await expect.poll(app.open).toBe(1);
    expect(await app.run(app.server.opened)).toHaveLength(2);
    await app.run(app.server.send(ready(t2)));

    await expect.poll(() => app.summaries()["b"]).toBe("Summary of b.");
    // One cheap request, from the server's time of the last event seen.
    expect(app.extra().filter((q) => q["updatedSince"] !== undefined)).toEqual([
      { updatedSince: t1, limit: "100" },
    ]);
    expect(app.reloads()).toBe(0);
  });

  it("backs off between attempts while the stream cannot be opened", async () => {
    const app = await setup({ reachable: false });
    await tick(150);
    const attempts = (await app.run(app.server.opened)).length;
    // 20 ms, then 40 ms each: about five in 150 ms, where a fixed 20 ms would make eight.
    expect(attempts).toBeGreaterThanOrEqual(2);
    expect(attempts).toBeLessThanOrEqual(6);
  });

  it("without a stream, asks only for the pending links, and stops when none is left", async () => {
    const app = await setup({ reachable: false });
    await expect.poll(() => app.extra().length).toBeGreaterThan(0);
    expect(app.extra()[0]).toEqual({ ids: "a,b", limit: "100" });

    // `a` is enriched: the next ask brings it, and from then on only `b` is asked for.
    app.stored.set("a", enrichedLink("a", t1));
    await expect.poll(() => app.summaries()["a"]).toBe("Summary of a.");
    await expect.poll(() => app.extra().at(-1)).toEqual({ ids: "b", limit: "100" });

    app.stored.set("b", enrichedLink("b", t2));
    await expect.poll(() => app.summaries()["b"]).toBe("Summary of b.");
    await tick(80);
    const settled = app.extra().length;
    await tick(200);
    // Nothing is pending: no more requests, however long the stream stays away.
    expect(app.extra().length).toBe(settled);
    expect(app.extra().every((q) => q["updatedSince"] === undefined)).toBe(true);
    expect(app.reloads()).toBe(0);
  });

  it("backs off between asks for the same pending links", async () => {
    const app = await setup({ reachable: false });
    await tick(260);
    // 30 ms, then 60 ms each: about five in 260 ms, where a fixed 30 ms would make eight.
    const asks = app.extra().length;
    expect(asks).toBeGreaterThanOrEqual(2);
    expect(asks).toBeLessThanOrEqual(6);
  });

  it("stops asking once the stream is open, after one ask for what waited", async () => {
    const app = await setup({ reachable: false });
    await expect.poll(() => app.extra().length).toBeGreaterThan(0);
    app.stored.set("a", enrichedLink("a", t1));
    await app.run(app.server.setReachable(true));
    await expect.poll(app.open).toBe(1);
    await app.run(app.server.send(ready(t2)));
    await expect.poll(() => app.summaries()["a"]).toBe("Summary of a.");
    await tick(80);
    const settled = app.extra().length;
    await tick(200);
    expect(app.extra().length).toBe(settled);
  });

  it("holds no stream while the tab is hidden, and catches up when it shows again", async () => {
    const app = await setup();
    await app.run(app.server.send(ready(t0)));
    await app.run(app.server.send(updated("a", t1)));
    await expect.poll(() => app.summaries()["a"]).toBe("Summary of a.");

    await app.run(app.visibility.setState("hidden"));
    await expect.poll(app.open).toBe(0);
    app.stored.set("b", enrichedLink("b", t2));
    const before = app.extra().length;
    await tick(120);
    // Hidden: no reconnect and no request.
    expect(await app.run(app.server.opened)).toHaveLength(1);
    expect(app.extra().length).toBe(before);

    await app.run(app.visibility.setState("visible"));
    await expect.poll(app.open).toBe(1);
    await app.run(app.server.send(ready(t2)));
    await expect.poll(() => app.summaries()["b"]).toBe("Summary of b.");
    expect(app.extra().slice(before)).toEqual([{ updatedSince: t1, limit: "100" }]);
  });

  it("catches up when the window gets the focus back", async () => {
    const app = await setup();
    await app.run(app.server.send(ready(t1)));
    await tick(10);
    const before = app.extra().length;
    app.stored.set("b", enrichedLink("b", t2));
    await app.run(app.visibility.focus);
    await expect.poll(() => app.summaries()["b"]).toBe("Summary of b.");
    expect(app.extra().slice(before)).toEqual([{ updatedSince: t1, limit: "100" }]);
    expect(app.reloads()).toBe(0);
  });
});

describe("ApiAtoms with live patches", () => {
  it("shows a patched link at once when its cached page opens again, then the api's answer", async () => {
    const app = await setup({ connect: false });
    const details = ApiAtoms.query(["links"], (client) =>
      client.links.list({ query: { limit: 3 } }),
    );
    const leave = app.registry.mount(details);
    await expect.poll(() => AsyncResult.isSuccess(app.registry.get(details))).toBe(true);
    leave();
    await tick();

    // The event arrives while no page reads the query.
    LinkPatches.record(app.registry, JSON.parse(updated("a", t1)) as never);
    const decoded = app.registry.get(LinkPatches.state);
    expect(decoded.size).toBe(1);

    const seen: Array<string | null | undefined> = [];
    const stop = app.registry.subscribe(
      details,
      (result) =>
        seen.push(AsyncResult.isSuccess(result) ? result.value.items[0]?.summary : undefined),
      { immediate: true },
    );
    await tick(30);
    stop();
    // Never the stale `null` first: the cached answer is read through the patch, and the
    // background refresh (which still answers the old copy here) does not undo it.
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((summary) => summary === "Summary of a.")).toBe(true);
  });

  it("tracks the pending links of the queries on screen only", async () => {
    const app = await setup({ connect: false });
    expect([...LinkPatches.pending(app.registry)].sort()).toEqual(["a", "b"]);
    LinkPatches.record(app.registry, JSON.parse(updated("a", t1)) as never);
    await expect.poll(() => [...LinkPatches.pending(app.registry)]).toEqual(["b"]);
  });
});
