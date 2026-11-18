import { describe, expect, it } from "@effect/vitest";
import * as Testing from "@stash/ext-platform/testing";
import * as Effect from "effect/Effect";
import * as OpenStash from "../src/open-stash.ts";

const origin = "https://stash.example.com";

const state = Effect.gen(function* () {
  const tabs = yield* (yield* Testing.TestTabs).all;
  const pages = yield* Testing.TestExtensionPages;
  return {
    urls: tabs.map((tab) => tab.url),
    active: tabs.filter((tab) => tab.active).map((tab) => tab.id),
    closed: yield* pages.closed,
    optionsOpened: yield* pages.optionsOpened,
  };
});

describe("openStash", () => {
  it.effect("opens the web app in a new tab when none is open, and closes the popup", () =>
    Effect.gen(function* () {
      yield* OpenStash.openStash(origin);
      expect(yield* state).toMatchObject({
        urls: ["https://example.com/tabs/1", "https://stash.example.com/"],
        active: [2],
        closed: 1,
      });
    }).pipe(Effect.provide(Testing.make({ tabs: [Testing.tab({ id: 1, active: true })] }))),
  );

  it.effect("switches to a Stash tab that is open, also in another window", () =>
    Effect.gen(function* () {
      yield* OpenStash.openStash(origin);
      const after = yield* state;
      expect(after.urls).toHaveLength(3);
      expect(after.active).toEqual([1, 3]);
      expect(after.closed).toBe(1);
    }).pipe(
      Effect.provide(
        Testing.make({
          tabs: [
            Testing.tab({ id: 1, active: true }),
            // Another site whose host only starts like Stash's.
            Testing.tab({
              id: 2,
              windowId: 2,
              url: "https://stash.example.com.invalid/",
              active: true,
            }),
            Testing.tab({ id: 3, windowId: 2, url: "https://stash.example.com/links" }),
          ],
        }),
      ),
    ),
  );
});

describe("search", () => {
  it.effect("opens the search page with the query", () =>
    Effect.gen(function* () {
      yield* OpenStash.search(origin, "  effect layers & вкладки ");
      const after = yield* state;
      expect(after.urls.at(-1)).toBe(
        "https://stash.example.com/search?q=effect%20layers%20%26%20%D0%B2%D0%BA%D0%BB%D0%B0%D0%B4%D0%BA%D0%B8",
      );
      expect(after.closed).toBe(1);
    }).pipe(Effect.provide(Testing.make())),
  );

  it.effect("just opens Stash for a blank query", () =>
    Effect.gen(function* () {
      yield* OpenStash.search(origin, "   ");
      expect((yield* state).urls).toEqual(["https://stash.example.com/"]);
    }).pipe(Effect.provide(Testing.make())),
  );
});

describe("openLink and connect", () => {
  it.effect("opens a saved link, and the options page to pair", () =>
    Effect.gen(function* () {
      yield* OpenStash.openLink("https://example.com/a");
      yield* OpenStash.connect;
      expect(yield* state).toEqual({
        urls: ["https://example.com/a"],
        active: [1],
        closed: 2,
        optionsOpened: 1,
      });
    }).pipe(Effect.provide(Testing.make())),
  );
});
