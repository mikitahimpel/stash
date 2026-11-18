import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import * as Link from "@stash/contracts-domain/link";
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

  const link = (overrides: Record<string, unknown>) =>
    Schema.decodeUnknownSync(Link.Link)({
      id: "a",
      url: "https://www.example.com/a",
      canonicalUrl: null,
      title: null,
      status: "new",
      type: "video",
      summary: null,
      language: null,
      imageUrl: null,
      author: null,
      tags: ["rust"],
      sourceDeviceId: "device-1",
      createdAt: "2026-03-09T00:00:00.000Z",
      enrichedAt: null,
      ...overrides,
    });

  it("tells whether a link passes the same filters", () => {
    const passes = (overrides: Partial<SearchRequest.Form>, data = {}) =>
      SearchRequest.passes(form(overrides), now, link(data));
    expect(passes({})).toBe(true);
    expect(passes({ type: "video", device: "device-1", range: "week", tag: "rust" })).toBe(true);
    expect(passes({ type: "repo" })).toBe(false);
    expect(passes({ device: "device-2" })).toBe(false);
    expect(passes({ tag: "go" })).toBe(false);
    expect(passes({ range: "week" }, { createdAt: "2026-02-01T00:00:00.000Z" })).toBe(false);
    expect(passes({ range: "year" }, { createdAt: "2026-02-01T00:00:00.000Z" })).toBe(true);
  });

  it("names a link's host without www., preferring the canonical URL", () => {
    expect(SearchRequest.host(link({}))).toBe("example.com");
    expect(SearchRequest.host(link({ canonicalUrl: "https://example.org/x" }))).toBe("example.org");
  });
});

describe("age", () => {
  it("is short at every scale", () => {
    const minute = 60_000;
    const day = 24 * 60 * minute;
    const ago = (ms: number) => SearchRequest.age(1_000_000_000_000 - ms, 1_000_000_000_000);
    expect(ago(0)).toBe("now");
    expect(ago(12 * minute)).toBe("12m");
    expect(ago(5 * 60 * minute)).toBe("5h");
    expect(ago(3 * day)).toBe("3d");
    expect(ago(21 * day)).toBe("3w");
    expect(ago(70 * day)).toBe("2mo");
    expect(ago(800 * day)).toBe("2y");
    // A clock a little behind the api's never shows a negative age.
    expect(SearchRequest.age(2_000, 1_000)).toBe("now");
  });
});

describe("matchesWords", () => {
  it("highlights terms in keyword and hybrid mode only", () => {
    expect(SearchRequest.matchesWords("keyword")).toBe(true);
    expect(SearchRequest.matchesWords("hybrid")).toBe(true);
    expect(SearchRequest.matchesWords("semantic")).toBe(false);
  });
});
