import { describe, expect, it } from "@effect/vitest";
import * as Link from "@stash/contracts-domain/link";
import * as CanonicalizeUrl from "../src/save/canonicalize-url.ts";

const canonical = (url: string) => CanonicalizeUrl.canonicalize(Link.Url.make(url));

describe("canonicalize", () => {
  it.each([
    // Host and scheme.
    ["HTTPS://Example.COM/Path", "https://example.com/Path"],
    ["https://www.example.com/a", "https://example.com/a"],
    ["https://example.com:443/a", "https://example.com/a"],
    ["http://example.com:80/a", "http://example.com/a"],
    ["http://example.com:8080/a", "http://example.com:8080/a"],
    ["https://example.com./a", "https://example.com/a"],
    // Trailing slash.
    ["https://example.com", "https://example.com/"],
    ["https://example.com/", "https://example.com/"],
    ["https://example.com/docs/", "https://example.com/docs"],
    ["https://example.com/docs//", "https://example.com/docs"],
    // Tracking parameters.
    ["https://example.com/a?utm_source=x&utm_medium=y&UTM_Campaign=z", "https://example.com/a"],
    ["https://example.com/a?fbclid=abc", "https://example.com/a"],
    ["https://example.com/a?gclid=1&msclkid=2&mc_cid=3&mc_eid=4", "https://example.com/a"],
    ["https://example.com/a?id=7&utm_source=x", "https://example.com/a?id=7"],
    ["https://example.com/a?id=7&ref_src=twsrc", "https://example.com/a?id=7"],
    // Remaining parameters are sorted, values kept.
    ["https://example.com/a?b=2&a=1", "https://example.com/a?a=1&b=2"],
    ["https://example.com/search?q=a+b", "https://example.com/search?q=a+b"],
    ["https://example.com/a?", "https://example.com/a"],
    // Fragments.
    ["https://example.com/a#section", "https://example.com/a"],
    ["https://example.com/app#/inbox/1", "https://example.com/app#/inbox/1"],
    ["https://example.com/app#!/inbox", "https://example.com/app#!/inbox"],
    // YouTube.
    ["https://youtu.be/dQw4w9WgXcQ", "https://youtube.com/watch?v=dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ?si=share&t=42", "https://youtube.com/watch?v=dQw4w9WgXcQ"],
    [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&feature=share&list=PL1",
      "https://youtube.com/watch?v=dQw4w9WgXcQ",
    ],
    ["https://m.youtube.com/watch?v=dQw4w9WgXcQ", "https://youtube.com/watch?v=dQw4w9WgXcQ"],
    ["https://youtube.com/shorts/abc123?feature=share", "https://youtube.com/watch?v=abc123"],
    ["https://www.youtube.com/embed/abc123", "https://youtube.com/watch?v=abc123"],
    ["https://www.youtube.com/live/abc123", "https://youtube.com/watch?v=abc123"],
    ["https://www.youtube.com/@channel", "https://youtube.com/@channel"],
    [
      "https://www.youtube.com/playlist?list=PL1&utm_source=x",
      "https://youtube.com/playlist?list=PL1",
    ],
  ])("%s → %s", (input, expected) => {
    expect(canonical(input)).toBe(expected);
  });

  it("is idempotent", () => {
    for (const url of [
      "https://www.Example.com/docs/?utm_source=x&b=2&a=1#top",
      "https://youtu.be/abc123",
    ]) {
      const once = canonical(url);
      expect(canonical(once)).toBe(once);
    }
  });
});
