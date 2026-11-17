import { describe, expect, it } from "@effect/vitest";
import * as JunkFilter from "../src/junk-filter.ts";

describe("JunkFilter.isSiteNameTitle", () => {
  it.each(["- YouTube", " - YouTube ", "YouTube", "youtube", "– YouTube", "YouTube |", " - ", ""])(
    "rejects %j",
    (title) => {
      expect(JunkFilter.isSiteNameTitle(title)).toBe(true);
    },
  );

  it.each([
    "A Synthetic Video - YouTube",
    "How YouTube ranks videos",
    "Example",
    "-1 is a number",
    "- My notes",
    "— Заметки",
    "| Example",
    "Как работает инфляция",
  ])("keeps %j", (title) => {
    expect(JunkFilter.isSiteNameTitle(title)).toBe(false);
  });
});

describe("JunkFilter.isJunkTag", () => {
  it.each(["unclassified", "missing title", "unknown topic", "unidentified topic", " Unknown "])(
    "rejects %j",
    (tag) => {
      expect(JunkFilter.isJunkTag(tag)).toBe(true);
    },
  );

  it.each(["economics", "youtube", "classification", "unknown pleasures"])("keeps %j", (tag) => {
    expect(JunkFilter.isJunkTag(tag)).toBe(false);
  });
});
