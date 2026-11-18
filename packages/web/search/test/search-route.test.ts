import { describe, expect, it } from "vitest";
import * as SearchRoute from "../src/search-route.ts";

describe("fromQuery", () => {
  it("is the empty search for a plain Inbox URL", () => {
    expect(SearchRoute.fromQuery({})).toEqual(SearchRoute.empty);
    expect(SearchRoute.fromQuery({ feed: "all", type: "video" })).toEqual(SearchRoute.empty);
  });

  it("reads the query as typed, the mode, the device and the range", () => {
    expect(
      SearchRoute.fromQuery({ q: "rust async ", mode: "keyword", device: "d1", range: "week" }),
    ).toEqual({ q: "rust async ", mode: "keyword", device: "d1", range: "week" });
  });

  it("falls back to the defaults for values it does not know", () => {
    expect(SearchRoute.fromQuery({ q: ["a", "b"], mode: "fuzzy", range: "decade" })).toEqual({
      ...SearchRoute.empty,
      q: "a",
    });
    expect(SearchRoute.fromQuery({ q: null })).toEqual(SearchRoute.empty);
  });
});

describe("searching", () => {
  it("is false for a blank query", () => {
    expect(SearchRoute.searching(SearchRoute.empty)).toBe(false);
    expect(SearchRoute.searching({ ...SearchRoute.empty, q: "  " })).toBe(false);
    expect(SearchRoute.searching({ ...SearchRoute.empty, q: "a" })).toBe(true);
  });
});

describe("withState", () => {
  it("keeps the Inbox's own parameters and leaves the defaults out", () => {
    expect(
      SearchRoute.withState({ feed: "all", type: "video" }, { ...SearchRoute.empty, q: "rust" }),
    ).toEqual({ feed: "all", type: "video", q: "rust" });
  });

  it("writes the mode, the device and the range when they are set", () => {
    expect(
      SearchRoute.withState({}, { q: "rust", mode: "semantic", device: "d1", range: "year" }),
    ).toEqual({ q: "rust", mode: "semantic", device: "d1", range: "year" });
  });

  it("drops the whole search once the query is blank", () => {
    expect(
      SearchRoute.withState(
        { tag: "go", q: "rust", mode: "keyword", device: "d1", range: "week" },
        { q: " ", mode: "keyword", device: "d1", range: "week" },
      ),
    ).toEqual({ tag: "go" });
  });
});

describe("withQ", () => {
  it("replaces the query and keeps the rest of the search", () => {
    expect(SearchRoute.withQ({ q: "rus", mode: "keyword", tag: "go" }, "rust")).toEqual({
      q: "rust",
      mode: "keyword",
      tag: "go",
    });
  });

  it("clears the search for a blank query", () => {
    expect(SearchRoute.withQ({ q: "rust", mode: "keyword", tag: "go" }, "")).toEqual({
      tag: "go",
    });
  });
});
