import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "@effect/vitest";
import * as SaveRequest from "../src/save/save-request.ts";

describe("/save address", () => {
  it.each([
    [
      "a raw URL from a Shortcut",
      "/save?url=https://example.com/a",
      { url: "https://example.com/a" },
    ],
    [
      "a raw URL with its own query and fragment",
      "/save?device=device-ios&url=https://example.com/a?b=1&c=2#top",
      { url: "https://example.com/a?b=1&c=2#top", deviceId: "device-ios" },
    ],
    [
      "an encoded URL and title from the bookmarklet",
      "/save?title=A%20synthetic%20page&url=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1%26c%3D2",
      { url: "https://example.com/a?b=1&c=2", title: "A synthetic page" },
    ],
    [
      "a title with plus signs for spaces",
      "/save?title=Two+words&url=https://example.com/b",
      { url: "https://example.com/b", title: "Two words" },
    ],
  ])("reads %s", (_, path, expected) => {
    expect(SaveRequest.parse(path)).toEqual(expected);
  });

  it.each([
    ["no query", "/save"],
    ["no url", "/save?title=x"],
    ["an empty url", "/save?url="],
    ["a url that is not http(s)", "/save?url=javascript:alert(1)"],
    ["a relative url", "/save?url=/links"],
  ])("refuses %s", (_, path) => {
    expect(SaveRequest.parse(path)).toBeUndefined();
  });

  it("drops an empty title and device", () => {
    expect(SaveRequest.parse("/save?title=&device=&url=https://example.com/c")).toEqual({
      url: "https://example.com/c",
    });
  });

  it("builds the address a guide or bookmarklet uses, and reads it back", () => {
    expect(SaveRequest.address("https://stash.example.com", { deviceId: "device-ios" })).toBe(
      "https://stash.example.com/save?device=device-ios&url=",
    );
    const full = SaveRequest.address("https://stash.example.com", {
      title: "A & B",
      url: "https://example.com/a?b=1&c=2",
    });
    expect(SaveRequest.parse(full.slice("https://stash.example.com".length))).toEqual({
      url: "https://example.com/a?b=1&c=2",
      title: "A & B",
    });
  });

  it("tells a link this save stored from one stored before", () => {
    const now = DateTime.makeUnsafe("2026-02-01T12:00:00Z");
    expect(SaveRequest.isFresh(DateTime.makeUnsafe("2026-02-01T11:59:30Z"), now)).toBe(true);
    // A client clock a little behind the api's.
    expect(SaveRequest.isFresh(DateTime.makeUnsafe("2026-02-01T12:01:00Z"), now)).toBe(true);
    expect(SaveRequest.isFresh(DateTime.makeUnsafe("2026-01-31T12:00:00Z"), now)).toBe(false);
  });
});
