import { describe, expect, it } from "@effect/vitest";
import * as Testing from "@stash/ext-platform/testing";
import * as Effect from "effect/Effect";
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
