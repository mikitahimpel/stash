import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as ContentHttp from "../src/content-http.ts";
import * as FetchPageText from "../src/fetch-page-text.ts";
import * as FakeHttp from "./fake-http.ts";
import * as Fixtures from "./fixtures.ts";

const routes = {
  "https://example.com/article": { body: Fixtures.articlePage },
  "https://example.com/de": { body: Fixtures.germanPage },
  "https://example.com/notes.txt": {
    body: "  Plain notes, and they are written in English for the test.  \n",
    contentType: "text/plain",
  },
  "https://example.com/paper.pdf": { body: "%PDF-1.7", contentType: "application/pdf" },
};

describe("FetchPageText.fetchPageText", () => {
  it.effect("extracts an HTML page", () =>
    Effect.gen(function* () {
      const content = yield* FetchPageText.fetchPageText("https://example.com/article");
      expect(content.source).toBe("page");
      expect(content.title).toEqual(Option.some("Building a Tiny Parser & Why It Works"));
      expect(content.description).toEqual(Option.some("A walk through a small HTML parser."));
      expect(content.language).toEqual(Option.some("en"));
      expect(content.text).toMatch(/^Building a Tiny Parser\nThe parser reads the page/);
    }).pipe(Effect.provide(FakeHttp.layer(routes))),
  );

  it.effect("detects the language from the text over a wrong lang attribute", () =>
    Effect.gen(function* () {
      const content = yield* FetchPageText.fetchPageText("https://example.com/de");
      expect(content.title).toEqual(Option.some("Ein Beispiel"));
      expect(content.language).toEqual(Option.some("de"));
    }).pipe(Effect.provide(FakeHttp.layer(routes))),
  );

  it.effect("takes plain text as is", () =>
    Effect.gen(function* () {
      const content = yield* FetchPageText.fetchPageText("https://example.com/notes.txt");
      expect(content.text).toBe("Plain notes, and they are written in English for the test.");
      expect(content.title).toEqual(Option.none());
      expect(content.language).toEqual(Option.some("en"));
    }).pipe(Effect.provide(FakeHttp.layer(routes))),
  );

  it.effect("rejects other content types", () =>
    Effect.gen(function* () {
      const error = yield* FetchPageText.fetchPageText("https://example.com/paper.pdf").pipe(
        Effect.flip,
      );
      expect(error.reason).toBe("UnsupportedContentType");
      expect(error.isTransient).toBe(false);
    }).pipe(Effect.provide(FakeHttp.layer(routes))),
  );

  it.effect("cuts long text to the policy's limit", () =>
    Effect.gen(function* () {
      const content = yield* FetchPageText.fetchPageText("https://example.com/article");
      expect(content.text.length).toBeLessThanOrEqual(30);
      expect(content.text.startsWith("Building a Tiny")).toBe(true);
    }).pipe(
      Effect.provideService(ContentHttp.FetchPolicy, {
        ...ContentHttp.defaultPolicy,
        maxTextLength: 30,
      }),
      Effect.provide(FakeHttp.layer(routes)),
    ),
  );
});
