import { describe, expect, it } from "@effect/vitest";
import * as Testing from "@stash/ext-platform/testing";
import * as DateTime from "effect/DateTime";
import * as TabsSnapshot from "../src/tabs-snapshot.ts";

const now = DateTime.makeUnsafe("2026-01-01T00:00:00Z");
const later = DateTime.makeUnsafe("2026-01-01T01:00:00Z");

describe("tabs snapshot", () => {
  it("keeps only tabs with an http(s) URL, in order", () => {
    const tabs = [
      Testing.tab({ id: 1, url: "https://example.com/a", title: "A" }),
      Testing.tab({ id: 2, url: "about:blank" }),
      Testing.tab({ id: 3, url: null, title: null }),
      Testing.tab({ id: 4, url: "http://example.com/b", title: null, hidden: true }),
      Testing.tab({ id: 5, url: "moz-extension://synthetic/options.html" }),
      Testing.tab({ id: 6, url: "https://example.com/private", incognito: true }),
    ];
    expect(TabsSnapshot.fromTabs(tabs, now)).toEqual([
      {
        url: "https://example.com/a",
        title: "A",
        openedAt: null,
        lastSeenAt: now,
        window: { id: "1" },
      },
      {
        url: "http://example.com/b",
        title: null,
        openedAt: null,
        lastSeenAt: now,
        window: { id: "1" },
      },
    ]);
  });

  it("carries when a tab was opened and last active, its window and an http(s) icon", () => {
    const tabs = [
      Testing.tab({
        id: 1,
        windowId: 7,
        lastAccessed: DateTime.toEpochMillis(now) - 1000,
        favIconUrl: "https://example.com/favicon.ico",
      }),
      Testing.tab({ id: 2, favIconUrl: "data:image/png;base64,AAAA" }),
    ];
    const opened = new Map([
      [1, { url: "https://example.com/tabs/1", at: DateTime.toEpochMillis(now) - 60_000 }],
    ]);
    const [first, second] = TabsSnapshot.fromTabs(tabs, now, opened);
    expect(first).toMatchObject({
      openedAt: DateTime.subtract(now, { minutes: 1 }),
      lastActiveAt: DateTime.subtract(now, { seconds: 1 }),
      window: { id: "7" },
      faviconUrl: "https://example.com/favicon.ico",
    });
    expect(second).not.toHaveProperty("faviconUrl");
    expect(second).not.toHaveProperty("lastActiveAt");
  });

  it("keeps when a tab was first seen at its url and forgets closed tabs", () => {
    const t = 1_000_000;
    const a = "https://example.com/a";
    const b = "https://example.com/b";
    const first = TabsSnapshot.trackOpened(
      new Map(),
      [Testing.tab({ id: 1, url: a }), Testing.tab({ id: 2, url: b, lastAccessed: t - 500 })],
      t,
    );
    expect([...first]).toEqual([
      [1, { url: a, at: t }],
      [2, { url: b, at: t - 500 }],
    ]);
    const second = TabsSnapshot.trackOpened(
      first,
      [Testing.tab({ id: 2, url: b }), Testing.tab({ id: 3, url: a })],
      t + 10,
    );
    expect([...second]).toEqual([
      [2, { url: b, at: t - 500 }],
      [3, { url: a, at: t + 10 }],
    ]);
  });

  it("starts a tab's time over when its url changes, as for a reused tab id", () => {
    const t = 1_000_000;
    const known = new Map([[1, { url: "https://example.com/old", at: t - 86_400_000 }]]);
    const tracked = TabsSnapshot.trackOpened(
      known,
      [Testing.tab({ id: 1, url: "https://example.com/new" })],
      t,
    );
    expect([...tracked]).toEqual([[1, { url: "https://example.com/new", at: t }]]);
  });

  it("hashes a switch of tabs and a move to another window, not the time", () => {
    const tabs = [Testing.tab({ id: 1, url: "https://example.com/a", lastAccessed: 1000 })];
    const hash = TabsSnapshot.hash(TabsSnapshot.fromTabs(tabs, now));
    const activated = [{ ...tabs[0]!, lastAccessed: 5000 }];
    expect(TabsSnapshot.hash(TabsSnapshot.fromTabs(activated, now))).not.toBe(hash);
    const moved = [{ ...tabs[0]!, windowId: 2 }];
    expect(TabsSnapshot.hash(TabsSnapshot.fromTabs(moved, now))).not.toBe(hash);
    expect(
      TabsSnapshot.hash(
        TabsSnapshot.fromTabs(tabs, now, new Map([[1, { url: "https://example.com/a", at: 5 }]])),
      ),
    ).toBe(hash);
  });

  it("hashes URLs and titles, not the time", () => {
    const tabs = [Testing.tab({ id: 1, url: "https://example.com/a", title: "A" })];
    const hash = TabsSnapshot.hash(TabsSnapshot.fromTabs(tabs, now));
    expect(TabsSnapshot.hash(TabsSnapshot.fromTabs(tabs, later))).toBe(hash);
    const renamed = [Testing.tab({ id: 1, url: "https://example.com/a", title: "A2" })];
    expect(TabsSnapshot.hash(TabsSnapshot.fromTabs(renamed, now))).not.toBe(hash);
    const reordered = [Testing.tab({ id: 2, url: "https://example.com/b" }), ...tabs];
    expect(TabsSnapshot.hash(TabsSnapshot.fromTabs(reordered, now))).not.toBe(
      TabsSnapshot.hash(TabsSnapshot.fromTabs([...tabs, reordered[0]!], now)),
    );
  });
});
