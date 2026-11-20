import { describe, expect, it } from "vitest";
import * as LiveRows from "../src/live-rows.ts";
import type * as OpenTabsView from "../src/open-tabs-view.ts";

const row = (key: string) => ({ key }) as unknown as OpenTabsView.TabRow;

const section = (id: string, parts: Record<string, ReadonlyArray<string>>) =>
  ({
    id,
    windows: Object.entries(parts).map(([partId, keys]) => ({ id: partId, tabs: keys.map(row) })),
  }) as unknown as OpenTabsView.Section;

const keys = (sections: ReadonlyArray<OpenTabsView.Section>) =>
  sections.map((s) => s.windows.map((part) => part.tabs.map((tab) => tab.key)));

describe("live rows", () => {
  it("finds the rows that left, where they were", () => {
    const before = [section("d", { w1: ["a", "b", "c"], w2: ["x"] })];
    const now = [section("d", { w1: ["a", "c"], w2: [] })];
    expect(
      LiveRows.left(before, now).map(({ tab, partId, index }) => [tab.key, partId, index]),
    ).toEqual([
      ["b", "w1", 1],
      ["x", "w2", 0],
    ]);
  });

  it("puts the leaving rows back at their places, clamped to the part's end", () => {
    const now = [section("d", { w1: ["a"] })];
    const leaving = [
      { tab: row("b"), sectionId: "d", partId: "w1", index: 1 },
      { tab: row("z"), sectionId: "d", partId: "w1", index: 9 },
      { tab: row("moved"), sectionId: "d", partId: "w-gone", index: 0 },
      { tab: row("gone"), sectionId: "other", partId: "w9", index: 0 },
    ];
    expect(keys(LiveRows.withLeaving(now, leaving))).toEqual([[["a", "b", "z", "moved"]]]);
    expect(LiveRows.withLeaving(now, [])).toBe(now);
  });
});
