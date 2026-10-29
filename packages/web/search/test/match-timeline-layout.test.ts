import { describe, expect, it } from "vitest";
import * as MatchTimelineLayout from "../src/timeline/match-timeline-layout.ts";

const now = Date.UTC(2026, 9, 27, 12);
const at = (id: string, iso: string) => ({ id, createdAt: Date.parse(iso) });

describe("layout", () => {
  it("spans the twelve months up to the current one when the data goes back that far", () => {
    const { ticks } = MatchTimelineLayout.layout({
      now,
      matches: [],
      saved: [at("old", "2025-11-03")],
    });
    expect(ticks.map((tick) => tick.label)).toEqual([
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
    expect(ticks[0]?.x).toBe(0);
    expect(ticks.every((tick, i) => i === 0 || tick.x > (ticks[i - 1]?.x ?? 1))).toBe(true);
  });

  it("starts with the month of the oldest link", () => {
    const { ticks } = MatchTimelineLayout.layout({
      now,
      matches: [at("a", "2026-06-20")],
      saved: [at("b", "2026-05-14")],
    });
    expect(ticks.map((tick) => tick.label)).toEqual(["May", "Jun", "Jul", "Aug", "Sep", "Oct"]);
  });

  it("fits recent data on a day axis with weekly ticks, at least 30 days long", () => {
    const result = MatchTimelineLayout.layout({
      now,
      matches: [at("a", "2026-10-26"), at("b", "2026-10-20")],
      saved: [at("c", "2026-10-25")],
    });
    // 30 days up to Oct 27: from Sep 28 (a Monday), weekly.
    expect(result.ticks.map((tick) => tick.label)).toEqual([
      "Sep 28",
      "Oct 5",
      "Oct 12",
      "Oct 19",
      "Oct 26",
    ]);
    // The data spreads over the axis instead of piling up at its end.
    const x = Object.fromEntries(result.matches.map((match) => [match.id, match.x]));
    expect(x.b).toBeLessThan(0.8);
    expect(x.a).toBeGreaterThan(0.9);
  });

  it("goes back to the oldest link when it is older than 30 days but recent", () => {
    const { ticks } = MatchTimelineLayout.layout({
      now,
      matches: [],
      saved: [at("a", "2026-08-10")],
    });
    expect(ticks[0]?.label).toBe("Aug 10");
    expect(ticks.at(-1)?.label).toBe("Oct 26");
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

  it("puts a number with no clear lane where it overlaps least", () => {
    const { matches } = MatchTimelineLayout.layout({
      now,
      matches: [
        at("a", "2026-06-01"),
        at("b", "2026-06-03"),
        at("c", "2026-06-05"),
        at("d", "2026-06-08"),
      ],
      saved: [at("old", "2025-11-03")],
    });
    // d is nearest to c and farthest from a, so it shares a's lane.
    expect(matches.map((match) => match.lane)).toEqual([0, 1, 2, 0]);
  });

  it("describes what it shows", () => {
    const result = MatchTimelineLayout.layout({
      now,
      matches: [at("a", "2026-06-01")],
      saved: [at("b", "2026-07-01"), at("c", "2026-08-01")],
    });
    expect(MatchTimelineLayout.describe(result)).toBe("1 match among 3 saved links, Jun to Oct");
  });
});
