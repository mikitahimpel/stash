import { describe, expect, it } from "@effect/vitest";
import * as Option from "effect/Option";
import * as ContentText from "../src/content-text.ts";

const base = "https://example.com/posts/one";

describe("ContentText.resolveImageUrl", () => {
  it.each([
    ["https://cdn.example.com/a.png", "https://cdn.example.com/a.png"],
    ["/images/a.png?v=2", "https://example.com/images/a.png?v=2"],
    ["a.png", "https://example.com/posts/a.png"],
    ["//cdn.example.com/a.png", "https://cdn.example.com/a.png"],
    ["  http://example.com/a.png ", "http://example.com/a.png"],
  ])("resolves %j against the page", (reference, expected) => {
    expect(ContentText.resolveImageUrl(reference, base)).toEqual(Option.some(expected));
  });

  it.each([
    "",
    "data:image/png;base64,AAAA",
    "javascript:alert(1)",
    "ftp://example.com/a.png",
    `https://example.com/${"a".repeat(ContentText.maxImageUrlLength)}`,
  ])("rejects %j", (reference) => {
    expect(ContentText.resolveImageUrl(reference, base)).toEqual(Option.none());
  });
});
