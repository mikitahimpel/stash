import { describe, expect, it } from "vitest";
import * as SiteTitle from "../src/media-row/site-title";

describe("SiteTitle.strip", () => {
  it.each([
    ["Synthetic repo · Example", "https://example.com/a", "Synthetic repo"],
    [
      "Example - owner/repo: a tiny queue",
      "https://example.com/owner/repo",
      "owner/repo: a tiny queue",
    ],
    ["Example - owner/repo · Example", "https://www.example.com/owner/repo", "owner/repo"],
    [
      "Voices for every app | Synthetic Labs",
      "https://syntheticlabs.example/",
      "Voices for every app",
    ],
    ["Layers – example.org", "https://docs.example.org/layers", "Layers"],
    ["Reading list — EXAMPLE", "https://example.co.uk/list", "Reading list"],
  ])("takes the site's name off %s", (title, url, shown) => {
    expect(SiteTitle.strip(title, url)).toBe(shown);
  });

  it.each([
    // Another name than the host's.
    ["Rates explained | Plain Economics", "https://example.com/rates"],
    // The name is part of the title, not set off from it.
    ["Example driven development", "https://example.com/edd"],
    ["A well-known example", "https://example.com/known"],
    // Nothing but the name.
    ["Example", "https://example.com/"],
    // Not a web page.
    ["Notes - blank", "about:blank"],
  ])("leaves %s as it is", (title, url) => {
    expect(SiteTitle.strip(title, url)).toBe(title);
  });
});
