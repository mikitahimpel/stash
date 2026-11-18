import { describe, expect, it } from "@effect/vitest";
import * as Link from "@stash/contracts-domain/link";
import * as Testing from "@stash/ext-platform/testing";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";
import type * as PopupLink from "../src/popup-link.ts";
import * as SavePage from "../src/save-page.ts";
import * as PopupApi from "./popup-api.ts";

const tabs = [
  Testing.tab({ id: 1, url: "https://example.com/new", title: "A new page", active: true }),
];
const id = (value: string) => Link.LinkId.make(value);

const layer = (api: ReturnType<typeof PopupApi.make>, options: Testing.Options = {}) =>
  Testing.make({ tabs, config: PopupApi.config, handler: api.handler, ...options });

describe("save", () => {
  it.effect("saves the active tab and says it was created", () => {
    const api = PopupApi.make();
    return Effect.gen(function* () {
      const result = yield* SavePage.save;
      expect(result).toMatchObject({
        _tag: "Saved",
        created: true,
        link: { url: "https://example.com/new", title: "A new page", enriched: false },
      });
      expect(api.links).toHaveLength(1);
    }).pipe(Effect.provide(layer(api)));
  });

  it.effect("answers the stored link for a page that was saved before", () => {
    const api = PopupApi.make({
      links: [PopupApi.link("old", { url: "https://example.com/new" })],
    });
    return Effect.gen(function* () {
      expect(yield* SavePage.save).toMatchObject({
        _tag: "Saved",
        created: false,
        link: { id: "old" },
      });
    }).pipe(Effect.provide(layer(api)));
  });

  it.effect("refuses a page that is not http(s) without calling the api", () => {
    const api = PopupApi.make();
    return Effect.gen(function* () {
      expect(yield* SavePage.save).toEqual({
        _tag: "Failed",
        message: "Only http(s) pages can be saved to Stash.",
      });
      expect(api.sent).toEqual([]);
    }).pipe(
      Effect.provide(
        layer(api, { tabs: [Testing.tab({ id: 1, url: "about:blank", active: true })] }),
      ),
    );
  });

  it.effect("turns a rejected token and a failing api into messages", () =>
    Effect.gen(function* () {
      const failed = (status: number) =>
        SavePage.save.pipe(Effect.provide(layer(PopupApi.make({ status }))));
      expect(yield* failed(401)).toEqual({
        _tag: "Failed",
        message: "This browser is not connected to Stash.",
      });
      expect(yield* failed(503)).toEqual({
        _tag: "Failed",
        message: "Could not reach Stash. Try again.",
      });
    }),
  );
});

describe("undo", () => {
  it.effect("deletes the link, and counts a link that is gone as removed", () => {
    const api = PopupApi.make({ links: [PopupApi.link("a")] });
    return Effect.gen(function* () {
      expect(yield* SavePage.undo(id("a"))).toEqual({ _tag: "Removed" });
      expect(api.links).toEqual([]);
      expect(yield* SavePage.undo(id("a"))).toEqual({ _tag: "Removed" });
    }).pipe(Effect.provide(layer(api)));
  });

  it.effect("reports an api that does not answer", () =>
    Effect.gen(function* () {
      expect(yield* SavePage.undo(id("a"))).toEqual({
        _tag: "Failed",
        message: "Could not reach Stash. Try again.",
      });
    }).pipe(Effect.provide(layer(PopupApi.make({ status: 503 })))),
  );
});

describe("watch", () => {
  it.effect("hands over each answer until the link is enriched", () => {
    const api = PopupApi.make({ links: [PopupApi.link("a")] });
    let asked = 0;
    // The third answer carries the tags.
    api.beforeGet((link) =>
      ++asked < 3
        ? link
        : { ...link, tags: ["invented", "video"], enrichedAt: "2026-01-01T00:00:06.000Z" },
    );
    const seen: Array<PopupLink.PopupLink> = [];
    return Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(SavePage.watch(id("a"), (link) => seen.push(link)));
      yield* TestClock.adjust("1 second");
      expect(seen).toHaveLength(0);
      yield* TestClock.adjust("1 minute");
      yield* Fiber.join(fiber);
      expect(seen.map((link) => link.tags)).toEqual([[], [], ["invented", "video"]]);
      expect(seen.at(-1)?.enriched).toBe(true);
      expect(asked).toBe(3);
    }).pipe(Effect.provide(layer(api)));
  });

  it.effect("gives up after the last attempt, and at once when the link is gone", () => {
    const api = PopupApi.make({ links: [PopupApi.link("a")] });
    let updates = 0;
    return Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(SavePage.watch(id("a"), () => updates++));
      yield* TestClock.adjust("10 minutes");
      yield* Fiber.join(fiber);
      expect(updates).toBe(SavePage.watchAttempts);

      const gone = yield* Effect.forkChild(SavePage.watch(id("missing"), () => updates++));
      yield* TestClock.adjust("10 minutes");
      yield* Fiber.join(gone);
      expect(updates).toBe(SavePage.watchAttempts);
    }).pipe(Effect.provide(layer(api)));
  });
});
