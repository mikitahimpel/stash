import { describe, expect, it } from "@effect/vitest";
import * as Storage from "@stash/ext-platform/browser-storage";
import type * as Tabs from "@stash/ext-platform/browser-tabs";
import * as Testing from "@stash/ext-platform/testing";
import * as Effect from "effect/Effect";
import type * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SaveAllAndClose from "../src/save-all-and-close.ts";

// Synthetic placeholders, not real values.
const config = { apiBaseUrl: "https://api.example.com", deviceToken: "synthetic-token" };

const link = (url: string) => ({
  id: `link-${url}`,
  url,
  canonicalUrl: null,
  title: null,
  status: "new",
  type: null,
  summary: null,
  language: null,
  tags: [],
  sourceDeviceId: "device-1",
  createdAt: "2026-01-01T00:00:00.000Z",
  enrichedAt: null,
});

type Body = { readonly links: ReadonlyArray<{ readonly url: string; readonly title?: string }> };

/**
 * A fake API for `POST /links/batch`. `answer` gets the batch and its index; by default every
 * link is saved.
 */
const api = (
  answer: (body: Body, index: number) => Response = (body) =>
    Response.json({ links: body.links.map((it) => link(it.url)) }, { status: 201 }),
) => {
  const sent: Array<{ readonly url: string; readonly body: Body }> = [];
  const handler = (request: HttpClientRequest.HttpClientRequest) =>
    Effect.sync(() => {
      const body =
        request.body._tag === "Uint8Array"
          ? (JSON.parse(new TextDecoder().decode(request.body.body)) as Body)
          : { links: [] };
      sent.push({ url: request.url, body });
      return answer(body, sent.length - 1);
    });
  return { sent, handler };
};

const openIds = Effect.flatMap(Testing.TestTabs, (tabs) =>
  Effect.map(tabs.all, (all) => all.map((tab) => tab.id)),
);

const openTabs = Effect.flatMap(Testing.TestTabs, (tabs) => tabs.all);

const saveAll = (target: SaveAllAndClose.Target) =>
  Effect.flatMap(SaveAllAndClose.plan(target), SaveAllAndClose.run);

const page = (id: number, fields: Partial<Tabs.Tab> = {}) =>
  Testing.tab({ id, url: `https://example.com/page/${id}`, title: `Page ${id}`, ...fields });

describe("save all & close", () => {
  it.effect(
    "saves the window's tabs in one batch and closes them, skipping pinned and internal",
    () => {
      const { sent, handler } = api();
      const tabs = [
        page(1, { pinned: true }),
        page(2, { active: true }),
        Testing.tab({ id: 3, url: "about:config", title: null }),
        page(4),
        page(5, { windowId: 2 }),
      ];
      return Effect.gen(function* () {
        const outcome = yield* saveAll({ windowId: 1 });
        expect(outcome).toEqual({ closed: 2, kept: 0, skipped: 2, problem: null });
        expect(sent).toEqual([
          {
            url: "https://api.example.com/links/batch",
            body: {
              links: [
                { url: "https://example.com/page/2", title: "Page 2" },
                { url: "https://example.com/page/4", title: "Page 4" },
              ],
            },
          },
        ]);
        // The pinned and internal tabs stay, so no blank tab is needed.
        expect(yield* openIds).toEqual([1, 3, 5]);
      }).pipe(Effect.provide(Testing.make({ tabs, config, handler })));
    },
  );

  it.effect("partial failure: closes only the tabs whose links came back saved", () => {
    const { handler } = api((body) =>
      Response.json(
        { links: body.links.filter((it) => !it.url.endsWith("/2")).map((it) => link(it.url)) },
        { status: 201 },
      ),
    );
    const tabs = [page(1), page(2), page(3)];
    return Effect.gen(function* () {
      const outcome = yield* saveAll({ windowId: 1 });
      expect(outcome).toEqual({ closed: 2, kept: 1, skipped: 0, problem: null });
      expect(yield* openIds).toEqual([2]);
    }).pipe(Effect.provide(Testing.make({ tabs, config, handler })));
  });

  it.effect("partial failure: a rate-limited batch keeps its tabs open and stops", () => {
    const { sent, handler } = api((body, index) =>
      index === 0
        ? Response.json({ links: body.links.map((it) => link(it.url)) }, { status: 201 })
        : Response.json({ _tag: "RateLimited", retryAfterSeconds: 60 }, { status: 429 }),
    );
    const count = 2 * 500 + 1;
    const tabs = Array.from({ length: count }, (_, index) => page(index + 1));
    return Effect.gen(function* () {
      const outcome = yield* saveAll({ windowId: 1 });
      expect(outcome).toEqual({ closed: 500, kept: 501, skipped: 0, problem: "RateLimited" });
      expect(sent.map((request) => request.body.links.length)).toEqual([500, 500]);
      const open = yield* openIds;
      expect(open).toHaveLength(501);
      expect(open[0]).toBe(501);
    }).pipe(Effect.provide(Testing.make({ tabs, config, handler })));
  });

  it.effect("offline: closes nothing", () => {
    const { handler } = api(() => new Response("unavailable", { status: 503 }));
    const tabs = [page(1), page(2)];
    return Effect.gen(function* () {
      expect(yield* saveAll({ windowId: 1 })).toEqual({
        closed: 0,
        kept: 2,
        skipped: 0,
        problem: "Offline",
      });
      expect(yield* openIds).toEqual([1, 2]);
    }).pipe(Effect.provide(Testing.make({ tabs, config, handler })));
  });

  it.effect("without a config: sends nothing and closes nothing", () => {
    const { sent, handler } = api();
    const tabs = [page(1)];
    return Effect.gen(function* () {
      expect((yield* saveAll({ windowId: 1 })).problem).toBe("NeedsSetup");
      expect(sent).toEqual([]);
      expect(yield* openIds).toEqual([1]);
    }).pipe(Effect.provide(Testing.make({ tabs, handler })));
  });

  it.effect("keeps one blank tab when every tab of the window is closed", () => {
    const { handler } = api();
    const tabs = [page(1), page(2)];
    return Effect.gen(function* () {
      expect(yield* saveAll({ windowId: 1 })).toEqual({
        closed: 2,
        kept: 0,
        skipped: 0,
        problem: null,
      });
      expect(yield* openTabs).toEqual([
        Testing.tab({ id: 3, windowId: 1, url: "about:newtab", title: "New Tab" }),
      ]);
    }).pipe(Effect.provide(Testing.make({ tabs, config, handler })));
  });

  it.effect("sends a URL open in two tabs once and closes both", () => {
    const { sent, handler } = api();
    const tabs = [
      page(1),
      page(2, { url: "https://example.com/page/1" }),
      page(3, { pinned: true }),
    ];
    return Effect.gen(function* () {
      expect((yield* saveAll({ windowId: 1 })).closed).toBe(2);
      expect(sent[0]?.body.links).toEqual([{ url: "https://example.com/page/1", title: "Page 1" }]);
      expect(yield* openIds).toEqual([3]);
    }).pipe(Effect.provide(Testing.make({ tabs, config, handler })));
  });

  it.effect("leaves hidden tabs (other Zen workspaces) alone", () => {
    const { handler } = api();
    const tabs = [page(1), page(2, { hidden: true })];
    return Effect.gen(function* () {
      expect(yield* saveAll({ windowId: 1 })).toEqual({
        closed: 1,
        kept: 0,
        skipped: 0,
        problem: null,
      });
      // The workspace would be empty, so it gets a blank tab.
      expect(yield* openIds).toEqual([2, 3]);
    }).pipe(Effect.provide(Testing.make({ tabs, config, handler })));
  });

  it.effect("with a workspace, saves only the workspace's tabs", () => {
    const { sent, handler } = api();
    const workspace = { id: "ws-1", name: "Research" };
    const tabs = [page(1), page(2), page(3)];
    return Effect.gen(function* () {
      const outcome = yield* saveAll({ windowId: 1, workspace });
      expect(outcome.closed).toBe(2);
      expect(sent[0]?.body.links.map((it) => it.url)).toEqual([
        "https://example.com/page/1",
        "https://example.com/page/3",
      ]);
      expect(yield* openIds).toEqual([2, 4]);
    }).pipe(
      Effect.provide(Testing.make({ tabs, config, handler, workspace, workspaceTabIds: [1, 3] })),
    );
  });
});

describe("save all & close: confirmation", () => {
  const target = Effect.flatMap(Storage.Storage, (storage) =>
    storage.get(SaveAllAndClose.targetStorageKey),
  );

  it.effect("the command stores the focused window and opens the popup; nothing is closed", () => {
    const { sent, handler } = api();
    const tabs = [page(1, { windowId: 2 }), page(2, { windowId: 3 })];
    return Effect.gen(function* () {
      yield* Layer.build(SaveAllAndClose.layer({ confirmPage: "/confirm.html" }));
      yield* (yield* Testing.TestCommands).trigger("save-current-tab");
      yield* (yield* Testing.TestCommands).trigger(SaveAllAndClose.commandName);
      yield* Effect.repeat(Effect.yieldNow, { times: 20 });
      expect(yield* (yield* Testing.TestTabs).popups).toEqual(["/confirm.html"]);
      expect(yield* target).toEqual(Option.some({ windowId: 2 }));
      expect(sent).toEqual([]);
      expect(yield* openIds).toEqual([1, 2]);

      const pending = yield* SaveAllAndClose.pending;
      expect(Option.map(pending, (plan) => plan.entries.map((entry) => entry.tab.id))).toEqual(
        Option.some([1]),
      );
    }).pipe(
      Effect.scoped,
      Effect.provide(Testing.make({ tabs, config, handler, currentWindowId: 2 })),
    );
  });

  it.effect("confirm runs the stored target once and forgets it", () => {
    const { handler } = api();
    const tabs = [page(1), page(2, { pinned: true })];
    return Effect.gen(function* () {
      expect(yield* SaveAllAndClose.confirm).toEqual(
        Option.some({ closed: 1, kept: 0, skipped: 1, problem: null }),
      );
      expect(yield* target).toEqual(Option.none());
      expect(yield* SaveAllAndClose.confirm).toEqual(Option.none());
      expect(yield* openIds).toEqual([2]);
    }).pipe(
      Effect.provide(
        Testing.make({
          tabs,
          config,
          handler,
          storage: { [SaveAllAndClose.targetStorageKey]: { windowId: 1 } },
        }),
      ),
    );
  });

  it.effect("dismiss forgets the target and closes the popup window", () => {
    const tabs = [page(1), page(2, { windowId: 9 })];
    return Effect.gen(function* () {
      yield* SaveAllAndClose.dismiss;
      expect(yield* target).toEqual(Option.none());
      // The popup is the current window (9); the other window keeps its tab.
      expect(yield* openIds).toEqual([1]);
    }).pipe(
      Effect.provide(
        Testing.make({
          tabs,
          currentWindowId: 9,
          storage: { [SaveAllAndClose.targetStorageKey]: { windowId: 1 } },
        }),
      ),
    );
  });

  it.effect("an unreadable stored target counts as none", () =>
    Effect.gen(function* () {
      expect(yield* SaveAllAndClose.pending).toEqual(Option.none());
    }).pipe(
      Effect.provide(
        Testing.make({ storage: { [SaveAllAndClose.targetStorageKey]: { windowId: "x" } } }),
      ),
    ),
  );
});
