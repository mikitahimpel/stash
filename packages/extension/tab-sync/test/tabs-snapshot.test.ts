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
    ];
    expect(TabsSnapshot.fromTabs(tabs, now)).toEqual([
      { url: "https://example.com/a", title: "A", openedAt: null, lastSeenAt: now },
      { url: "http://example.com/b", title: null, openedAt: null, lastSeenAt: now },
    ]);
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
