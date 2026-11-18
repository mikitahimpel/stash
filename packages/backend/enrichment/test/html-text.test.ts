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

  it("reads the author when it is a name, not a profile URL, an address or a paragraph", () => {
    expect(HtmlText.parse(Fixtures.ogImagePage).author).toEqual(Option.some("Ada Example"));
    expect(HtmlText.parse(Fixtures.twitterImagePage).author).toEqual(Option.some("Grace Example"));
    expect(HtmlText.parse(Fixtures.dataImagePage).author).toEqual(Option.none());
    expect(HtmlText.authorName("ada@example.com")).toEqual(Option.none());
    expect(HtmlText.authorName("www.example.com/ada")).toEqual(Option.none());
    expect(HtmlText.authorName("a".repeat(HtmlText.maxAuthorLength + 1))).toEqual(Option.none());
    expect(HtmlText.authorName("   ")).toEqual(Option.none());
  });

  it("handles an empty document", () => {
    expect(HtmlText.parse("")).toEqual({
      title: Option.none(),
      description: Option.none(),
      lang: Option.none(),
      image: Option.none(),
      author: Option.none(),
      text: "",
    });
  });

  it("reads the preview image as written: og:image first, then twitter:image", () => {
    expect(HtmlText.parse(Fixtures.ogImagePage).image).toEqual(
      Option.some("/images/preview.png?v=2"),
    );
    expect(HtmlText.parse(Fixtures.twitterImagePage).image).toEqual(
      Option.some("https://cdn.example.com/twitter.png"),
    );
    expect(HtmlText.parse(Fixtures.articlePage).image).toEqual(Option.none());
  });
});

describe("HtmlText.parse on real sites' markup (#155)", () => {
  it("reads a GitHub repository's social card", () => {
    const page = HtmlText.parse(Fixtures.githubRepoPage);
    expect(page.image).toEqual(Option.some(Fixtures.githubRepoImage));
    expect(page.title).toEqual(
      Option.some("GitHub - synthetic-owner/synthetic-repo: A synthetic repository for tests"),
    );
    expect(page.author).toEqual(Option.none());
  });

  it("reads a Hugging Face Space's thumbnail", () => {
    const page = HtmlText.parse(Fixtures.huggingFaceSpacePage);
    expect(page.image).toEqual(Option.some(Fixtures.huggingFaceSpaceImage));
    expect(page.title).toEqual(
      Option.some("Synthetic Space - a Hugging Face Space by synthetic-owner"),
    );
  });
});

describe("HtmlText.decodeEntities", () => {
  it("decodes named and numeric references and keeps unknown ones", () => {
    expect(HtmlText.decodeEntities("a &amp; b &#60; &#x3E; &hellip; &bogus; &#xFFFFFFF;")).toBe(
      "a & b < > … &bogus; &#xFFFFFFF;",
    );
  });
});
