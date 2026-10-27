import { describe, expect, it } from "vitest";
import * as MatchTimelineLayout from "../src/timeline/match-timeline-layout.ts";

const now = Date.UTC(2026, 9, 27, 12);
const at = (id: string, iso: string) => ({ id, createdAt: Date.parse(iso) });

describe("layout", () => {
  it("spans the twelve months up to the current one", () => {
    const { months } = MatchTimelineLayout.layout({ now, matches: [], saved: [] });
    expect(months.map((month) => month.label)).toEqual([
      "Nov",
      "Dec",
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
    ]);
    expect(months[0]?.x).toBe(0);
    expect(months.every((month, i) => i === 0 || month.x > (months[i - 1]?.x ?? 1))).toBe(true);
  });

  it("numbers the matches by rank, not by date", () => {
    const { matches } = MatchTimelineLayout.layout({
      now,
      matches: [at("b", "2026-09-01"), at("a", "2026-01-01"), at("c", "2026-05-01")],
      saved: [],
    });
    expect(matches.map((match) => [match.id, match.rank])).toEqual([
      ["b", 1],
      ["a", 2],
      ["c", 3],
    ]);
    const x = Object.fromEntries(matches.map((match) => [match.id, match.x]));
    expect(x.a).toBeLessThan(x.c ?? 0);
    expect(x.c).toBeLessThan(x.b ?? 0);
  });

  it("keeps the rank of a match after older ones are left out", () => {
    const result = MatchTimelineLayout.layout({
      now,
      matches: [at("old", "2024-03-01"), at("new", "2026-10-01")],
      saved: [],
    });
    expect(result.matches.map((match) => [match.id, match.rank])).toEqual([["new", 2]]);
    expect(result.older).toBe(1);
  });

  it("draws saved links that aren't matches as dots, within the twelve months", () => {
    const result = MatchTimelineLayout.layout({
      now,
      matches: [at("a", "2026-06-01")],
      saved: [at("a", "2026-06-01"), at("b", "2026-07-01"), at("c", "2023-01-01")],
    });
    expect(result.dots).toHaveLength(1);
    expect(result.dots[0]).toBeGreaterThan(0);
    expect(result.dots[0]).toBeLessThan(1);
  });

  it("puts numbers that would overlap on separate lanes", () => {
    const { matches } = MatchTimelineLayout.layout({
      now,
      matches: [at("a", "2026-06-01"), at("b", "2026-06-02"), at("c", "2026-02-01")],
      saved: [],
    });
    expect(matches.map((match) => match.lane)).toEqual([0, 1, 0]);
  });

  it("describes what it shows", () => {
    const result = MatchTimelineLayout.layout({
      now,
      matches: [at("a", "2026-06-01")],
      saved: [at("b", "2026-07-01"), at("c", "2026-08-01")],
    });
    expect(MatchTimelineLayout.describe(result)).toBe("1 match among 3 saved links, Nov to Oct");
  });
});
