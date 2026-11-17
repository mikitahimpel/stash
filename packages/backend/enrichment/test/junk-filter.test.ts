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

describe("JunkFilter.isMetaSummary", () => {
  it.each([
    "The page text and title were unavailable, so the topic of this YouTube video cannot be determined.",
    "The topic could not be determined from the URL alone.",
    "Unable to determine what this video is about.",
    "The content could not be fetched.",
    "No content was provided for this link.",
    "A YouTube video; its content is not available.",
    "Без текста страницы невозможно определить тему видео.",
    "Содержимое страницы недоступно.",
  ])("rejects %j", (summary) => {
    expect(JunkFilter.isMetaSummary(summary)).toBe(true);
  });

  it.each([
    "A walk through a tiny HTML parser and why it works.",
    "How central banks determine interest rates, and why it matters.",
    "Объяснение инфляции простыми словами.",
    "A talk on making services available in several regions.",
    "Why the feature is not available in Europe, and what to use instead.",
    // Real summaries a looser filter took for junk (review of #150).
    "Full details are available in the linked documentation.",
    "The text of the specification is available on GitHub.",
    "An outage report: users were unable to access their accounts for three hours.",
    "How to design pages without content layout shifts.",
    "Explains why the root cause could not be determined by the incident team.",
    "It is impossible to determine a particle's position and momentum at once.",
    "Объясняет, почему невозможно определить точное время события.",
  ])("keeps %j", (summary) => {
    expect(JunkFilter.isMetaSummary(summary)).toBe(false);
  });
});
