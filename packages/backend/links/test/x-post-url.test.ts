import { describe, expect, it } from "@effect/vitest";
import * as Option from "effect/Option";
import * as XPostUrl from "../src/save/x-post-url.ts";

describe("XPostUrl", () => {
  it.each([
    ["https://x.com/example_writer/status/1700000000000000001", "example_writer"],
    ["https://twitter.com/Example_Writer/status/1700000000000000001?s=20&t=abc", "Example_Writer"],
    ["https://www.twitter.com/example_writer/statuses/1700000000000000001", "example_writer"],
    ["https://mobile.twitter.com/example_writer/status/1700000000000000001", "example_writer"],
    ["https://m.twitter.com/example_writer/status/1700000000000000001", "example_writer"],
    ["https://fxtwitter.com/example_writer/status/1700000000000000001/en", "example_writer"],
    ["https://vxtwitter.com/example_writer/status/1700000000000000001", "example_writer"],
    ["https://x.com/example_writer/status/1700000000000000001/photo/2", "example_writer"],
    ["https://x.com/i/status/1700000000000000001", "i"],
    ["https://x.com/i/web/status/1700000000000000001", "i"],
  ])("reads the post of %s", (url, handle) => {
    expect(XPostUrl.target(url)).toEqual(Option.some({ handle, id: "1700000000000000001" }));
    expect(XPostUrl.isXHost(url)).toBe(true);
  });

  it.each([
    "https://x.com/example_writer",
    "https://x.com/search?q=status",
    "https://x.com/example_writer/status/not-an-id",
    "https://x.com/i/lists/1700000000000000001",
  ])("%s is on X but is no post", (url) => {
    expect(XPostUrl.target(url)).toEqual(Option.none());
    expect(XPostUrl.isXHost(url)).toBe(true);
  });

  it.each(["https://example.com/a/status/1", "https://notx.com/a/status/1", "not a url"])(
    "%s is not on X",
    (url) => {
      expect(XPostUrl.target(url)).toEqual(Option.none());
      expect(XPostUrl.isXHost(url)).toBe(false);
    },
  );

  it("has one dedupe form per post", () => {
    expect(XPostUrl.canonicalUrl({ handle: "Example_Writer", id: "1700000000000000001" })).toBe(
      "https://x.com/example_writer/status/1700000000000000001",
    );
  });
});
