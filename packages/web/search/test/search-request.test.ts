import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vitest";
import * as SearchRequest from "../src/search-request.ts";

const form = (overrides: Partial<SearchRequest.Form>): SearchRequest.Form => ({
  ...SearchRequest.emptyForm,
  ...overrides,
});

const now = DateTime.makeUnsafe("2026-03-10T14:25:30.000Z");

describe("fromForm", () => {
  it("is undefined for a blank query", () => {
    expect(SearchRequest.fromForm(form({ q: "" }), now)).toBeUndefined();
    expect(
      SearchRequest.fromForm(form({ q: "   ", type: "video", tag: "rust" }), now),
    ).toBeUndefined();
  });

  it("sends the trimmed query and the mode", () => {
    expect(
      SearchRequest.fromForm(form({ q: "  vector databases ", mode: "semantic" }), now),
    ).toEqual({
      q: "vector databases",
      mode: "semantic",
    });
  });

  it("adds the type and tag filters when set", () => {
    expect(
      SearchRequest.fromForm(form({ q: "effect", type: "repo", tag: " TypeScript " }), now),
    ).toEqual({ q: "effect", mode: "hybrid", type: "repo", tag: "typescript" });
  });

  it("leaves out filters that are empty or not valid", () => {
    expect(SearchRequest.fromForm(form({ q: "effect", type: "", tag: "  " }), now)).toEqual({
      q: "effect",
      mode: "hybrid",
    });
    expect(SearchRequest.fromForm(form({ q: "effect", tag: "x".repeat(65) }), now)).toEqual({
      q: "effect",
      mode: "hybrid",
    });
  });

  it("cuts the query to the contract's 500 characters", () => {
    expect(SearchRequest.fromForm(form({ q: "a".repeat(600) }), now)?.q).toHaveLength(500);
  });
});

describe("filters", () => {
  it("adds the device, and the date range counted back from the start of the hour", () => {
    expect(
      SearchRequest.fromForm(form({ q: "effect", device: "device-1", range: "week" }), now),
    ).toEqual({
      q: "effect",
      mode: "hybrid",
      deviceId: "device-1",
      since: DateTime.makeUnsafe("2026-03-03T14:00:00.000Z"),
    });
    expect(SearchRequest.since("month", now)).toEqual(
      DateTime.makeUnsafe("2026-02-08T14:00:00.000Z"),
    );
    expect(SearchRequest.since("year", now)).toEqual(
      DateTime.makeUnsafe("2025-03-10T14:00:00.000Z"),
    );
  });

  it("keeps a range stable within the hour, so a repeated search is the same request", () => {
    const later = DateTime.makeUnsafe("2026-03-10T14:59:59.000Z");
    expect(SearchRequest.since("week", later)).toEqual(SearchRequest.since("week", now));
  });
});

describe("matchesWords", () => {
  it("highlights terms in keyword and hybrid mode only", () => {
    expect(SearchRequest.matchesWords("keyword")).toBe(true);
    expect(SearchRequest.matchesWords("hybrid")).toBe(true);
    expect(SearchRequest.matchesWords("semantic")).toBe(false);
  });
});
