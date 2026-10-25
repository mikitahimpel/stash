import { describe, expect, it } from "@effect/vitest";
import * as Option from "effect/Option";
import * as HtmlText from "../src/html-text.ts";
import * as Fixtures from "./fixtures.ts";

describe("HtmlText.parse", () => {
  it("extracts title, description, lang and the main article's text", () => {
    const page = HtmlText.parse(Fixtures.articlePage);
    expect(page.title).toEqual(Option.some("Building a Tiny Parser & Why It Works"));
    expect(page.description).toEqual(Option.some("A walk through a small HTML parser."));
    expect(page.lang).toEqual(Option.some("en-US"));
    expect(page.text).toBe(
      [
        "Building a Tiny Parser",
        "The parser reads the page and keeps only the text that matters. It is small, and it is fast enough for the job.",
        "It turns inline tags into spaces — and blocks into lines.",
        "First point",
        "Second point ✓",
      ].join("\n"),
    );
  });

  it("drops scripts, styles, navigation and comments", () => {
    const { text } = HtmlText.parse(Fixtures.articlePage);
    for (const unwanted of [
      "tracking",
      "inline script",
      "Home",
      "banner",
      "comment",
      "Copyright",
    ]) {
      expect(text).not.toContain(unwanted);
    }
  });

  it("falls back to Open Graph and Twitter meta, and to the whole body", () => {
    const page = HtmlText.parse(Fixtures.ogOnlyPage);
    expect(page.title).toEqual(Option.some("Only Open Graph"));
    expect(page.description).toEqual(Option.some("From the twitter card."));
    expect(page.lang).toEqual(Option.none());
    expect(page.text).toBe("Body text without a main region.");
  });

  it("handles an empty document", () => {
    expect(HtmlText.parse("")).toEqual({
      title: Option.none(),
      description: Option.none(),
      lang: Option.none(),
      text: "",
    });
  });
});

describe("HtmlText.decodeEntities", () => {
  it("decodes named and numeric references and keeps unknown ones", () => {
    expect(HtmlText.decodeEntities("a &amp; b &#60; &#x3E; &hellip; &bogus; &#xFFFFFFF;")).toBe(
      "a & b < > … &bogus; &#xFFFFFFF;",
    );
  });
});
