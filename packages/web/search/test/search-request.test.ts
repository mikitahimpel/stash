import { describe, expect, it } from "vitest";
import * as SearchRequest from "../src/search-request.ts";

const form = (overrides: Partial<SearchRequest.Form>): SearchRequest.Form => ({
  ...SearchRequest.emptyForm,
  ...overrides,
});

describe("fromForm", () => {
  it("is undefined for a blank query", () => {
    expect(SearchRequest.fromForm(form({ q: "" }))).toBeUndefined();
    expect(SearchRequest.fromForm(form({ q: "   ", type: "video", tag: "rust" }))).toBeUndefined();
  });

  it("sends the trimmed query and the mode", () => {
    expect(SearchRequest.fromForm(form({ q: "  vector databases ", mode: "semantic" }))).toEqual({
      q: "vector databases",
      mode: "semantic",
    });
  });

  it("adds the type and tag filters when set", () => {
    expect(
      SearchRequest.fromForm(form({ q: "effect", type: "repo", tag: " TypeScript " })),
    ).toEqual({ q: "effect", mode: "hybrid", type: "repo", tag: "typescript" });
  });

  it("leaves out filters that are empty or not valid", () => {
    expect(SearchRequest.fromForm(form({ q: "effect", type: "", tag: "  " }))).toEqual({
      q: "effect",
      mode: "hybrid",
    });
    expect(SearchRequest.fromForm(form({ q: "effect", tag: "x".repeat(65) }))).toEqual({
      q: "effect",
      mode: "hybrid",
    });
  });

  it("cuts the query to the contract's 500 characters", () => {
    expect(SearchRequest.fromForm(form({ q: "a".repeat(600) }))?.q).toHaveLength(500);
  });
});

describe("topTags", () => {
  const links = [{ tags: ["rust", "go"] }, { tags: ["rust"] }, { tags: ["effect", "go", "rust"] }];

  it("offers the most frequent tags first, ties by name", () => {
    expect(SearchRequest.topTags(links, "")).toEqual(["rust", "go", "effect"]);
  });

  it("keeps the selected tag even when it isn't frequent", () => {
    expect(SearchRequest.topTags(links, "zig")).toEqual(["rust", "go", "effect", "zig"]);
    expect(SearchRequest.topTags([], "zig")).toEqual(["zig"]);
  });

  it("offers at most a handful", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ tags: [`tag-${i}`] }));
    expect(SearchRequest.topTags(many, "")).toHaveLength(SearchRequest.tagChipCount);
  });
});

describe("matchesWords", () => {
  it("highlights terms in keyword and hybrid mode only", () => {
    expect(SearchRequest.matchesWords("keyword")).toBe(true);
    expect(SearchRequest.matchesWords("hybrid")).toBe(true);
    expect(SearchRequest.matchesWords("semantic")).toBe(false);
  });
});
