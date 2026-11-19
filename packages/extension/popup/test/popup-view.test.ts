import { describe, expect, it } from "@effect/vitest";
import * as Testing from "@stash/ext-platform/testing";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";
import type * as PopupLink from "../src/popup-link.ts";
import * as PopupView from "../src/popup-view.ts";
import * as PopupApi from "./popup-api.ts";

const tabs = [
  Testing.tab({ id: 1, url: "https://example.com/other" }),
  Testing.tab({
    id: 2,
    url: "https://www.example.com/a",
    title: "  An invented article  ",
    favIconUrl: "https://example.com/favicon.ico",
    active: true,
  }),
];

describe("currentPage", () => {
  it.effect("describes the active tab", () =>
    Effect.gen(function* () {
      expect(yield* PopupView.currentPage).toEqual({
        url: "https://www.example.com/a",
        title: "An invented article",
        host: "example.com",
        favIconUrl: "https://example.com/favicon.ico",
        savable: true,
      });
    }).pipe(Effect.provide(Testing.make({ tabs }))),
  );

  it.effect("marks a page that is not http(s) as not savable", () =>
    Effect.gen(function* () {
      expect(yield* PopupView.currentPage).toEqual({
        url: "about:config",
        title: "This page",
        host: "",
        favIconUrl: null,
        savable: false,
      });
    }).pipe(
      Effect.provide(
        Testing.make({
          tabs: [Testing.tab({ id: 1, url: "about:config", title: "", active: true })],
        }),
      ),
    ),
  );

  it.effect("is null without a tab", () =>
    Effect.gen(function* () {
      expect(yield* PopupView.currentPage).toBeNull();
    }).pipe(Effect.provide(Testing.make())),
  );
});

describe("load", () => {
  it.effect("is not paired until a device token is saved, and calls nothing", () => {
    const api = PopupApi.make();
    return Effect.gen(function* () {
      expect(yield* PopupView.load).toEqual({
        connection: { _tag: "NotPaired" },
        saved: null,
        recent: [],
      });
      expect(api.sent).toEqual([]);
    }).pipe(Effect.provide(Testing.make({ tabs, handler: api.handler })));
  });

  it.effect("is not paired when the api rejects the token", () => {
    const api = PopupApi.make({ status: 401 });
    return Effect.gen(function* () {
      expect((yield* PopupView.load).connection).toEqual({ _tag: "NotPaired" });
    }).pipe(Effect.provide(Testing.make({ tabs, config: PopupApi.config, handler: api.handler })));
  });

  it.effect("is unreachable when the api does not answer", () => {
    const api = PopupApi.make({ status: 503 });
    return Effect.gen(function* () {
      expect(yield* PopupView.load).toEqual({
        connection: { _tag: "Unreachable", webOrigin: "https://stash.example.com" },
        saved: null,
        recent: [],
      });
    }).pipe(Effect.provide(Testing.make({ tabs, config: PopupApi.config, handler: api.handler })));
  });

  it.effect("names the device, finds the page's link by URL and lists the latest five", () => {
    const links = [
      PopupApi.link("a", { url: "https://www.example.com/a", tags: ["invented"] }),
      ...["b", "c", "d", "e", "f"].map((id) => PopupApi.link(id)),
    ];
    const api = PopupApi.make({ links });
    return Effect.gen(function* () {
      const view = yield* PopupView.load;
      expect(view.connection).toEqual({
        _tag: "Connected",
        deviceName: "Zen on desk",
        webOrigin: "https://stash.example.com",
      });
      expect(view.saved).toMatchObject({ id: "a", tags: ["invented"], enriched: false });
      expect(view.recent.map((link) => link.id)).toEqual(["a", "b", "c", "d", "e"]);
      expect(api.sent.filter((it) => it.path === "/links").map((it) => it.query)).toEqual(
        expect.arrayContaining([
          { url: "https://www.example.com/a", limit: "1" },
          { sort: "recent", limit: "5" },
        ]),
      );
    }).pipe(Effect.provide(Testing.make({ tabs, config: PopupApi.config, handler: api.handler })));
  });

  it.effect("has no saved link for a new page, and looks nothing up for one it can't save", () => {
    const api = PopupApi.make({ links: [PopupApi.link("b")], principal: { kind: "user" } });
    return Effect.gen(function* () {
      const view = yield* PopupView.load;
      expect(view.saved).toBeNull();
      expect(view.connection).toMatchObject({ _tag: "Connected", deviceName: null });
      expect(view.recent).toHaveLength(1);
      expect(api.sent.some((it) => "url" in it.query)).toBe(false);
      expect(api.sent.some((it) => it.path === "/devices")).toBe(false);
    }).pipe(
      Effect.provide(
        Testing.make({
          tabs: [Testing.tab({ id: 1, url: "about:addons", active: true })],
          config: PopupApi.config,
          handler: api.handler,
        }),
      ),
    );
  });
});

describe("catchUp", () => {
  const enrichedAt = "2026-01-01T00:00:06.000Z";
  const layerOf = (api: ReturnType<typeof PopupApi.make>) =>
    Testing.make({ tabs, config: PopupApi.config, handler: api.handler });

  it.effect("asks only for the pending links, with growing waits, until all are enriched", () => {
    const api = PopupApi.make({
      links: [PopupApi.link("a"), PopupApi.link("b", { enrichedAt }), PopupApi.link("c")],
    });
    // `a` is enriched by the second ask, `c` by the third.
    const asks = () => api.sent.filter((it) => it.query["ids"] !== undefined).length;
    api.beforeGet((link) => {
      const due = link.id === "a" ? 2 : link.id === "c" ? 3 : 0;
      return link.enrichedAt === null && due > 0 && asks() >= due
        ? { ...link, tags: ["invented"], enrichedAt }
        : link;
    });
    const seen: Array<PopupLink.PopupLink> = [];
    return Effect.gen(function* () {
      const view = yield* PopupView.load;
      api.sent.length = 0;
      const fiber = yield* Effect.forkChild(
        PopupView.catchUp(view.recent, (link) => seen.push(link)),
      );
      yield* TestClock.adjust("2 seconds");
      expect(api.sent).toHaveLength(0);
      yield* TestClock.adjust("1 second");
      expect(api.sent.map((it) => it.query["ids"])).toEqual(["a,c"]);
      yield* TestClock.adjust("6 seconds");
      expect(api.sent.map((it) => it.query["ids"])).toEqual(["a,c", "a,c"]);
      expect(seen.map((link) => link.id)).toEqual(["a"]);
      yield* TestClock.adjust("12 seconds");
      yield* Fiber.join(fiber);
      expect(api.sent.map((it) => it.query["ids"])).toEqual(["a,c", "a,c", "c"]);
      expect(seen.map((link) => [link.id, link.enriched, link.tags])).toEqual([
        ["a", true, ["invented"]],
        ["c", true, ["invented"]],
      ]);
      // Nothing is pending: no more requests.
      yield* TestClock.adjust("10 minutes");
      expect(api.sent).toHaveLength(3);
    }).pipe(Effect.provide(layerOf(api)));
  });

  it.effect("asks nothing when every link is enriched, and gives up after the last attempt", () => {
    const api = PopupApi.make({ links: [PopupApi.link("a")] });
    return Effect.gen(function* () {
      const view = yield* PopupView.load;
      api.sent.length = 0;
      yield* PopupView.catchUp(
        view.recent.map((link) => ({ ...link, enriched: true })),
        () => {},
      );
      expect(api.sent).toHaveLength(0);

      const fiber = yield* Effect.forkChild(PopupView.catchUp(view.recent, () => {}));
      yield* TestClock.adjust("1 hour");
      yield* Fiber.join(fiber);
      expect(api.sent).toHaveLength(PopupView.catchUpAttempts);
    }).pipe(Effect.provide(layerOf(api)));
  });
});
