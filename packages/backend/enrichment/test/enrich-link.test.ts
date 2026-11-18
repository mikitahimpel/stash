import * as SaveLink from "@stash/backend-links/save-link";
import * as D1Database from "@stash/backend-platform/d1-database";
import * as Testing from "@stash/backend-platform/testing";
import * as Vectors from "@stash/backend-platform/vectors";
import * as Link from "@stash/contracts-domain/link";
import { describe, expect, it } from "@effect/vitest";
import * as AiError from "effect/ai/AiError";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type * as ClassifyLink from "../src/classify-link.ts";
import * as EnrichLink from "../src/enrich-link.ts";
import * as FetchYoutubeOembed from "../src/fetch-youtube-oembed.ts";
import * as FetchYoutubeTranscript from "../src/fetch-youtube-transcript.ts";
import * as StoreText from "../src/store-text.ts";
import * as EnrichmentTestLayer from "./enrichment-test-layer.ts";
import * as FakeLanguageModel from "./fake-language-model.ts";
import * as Fixtures from "./fixtures.ts";

const articleUrl = "https://example.com/article";

const classification: ClassifyLink.ClassificationOutput = {
  tags: ["Parsing", "html", "typescript"],
  summary: "A walk through a tiny HTML parser and why it works.",
  type: "article",
  language: "en",
};

const videoId = Fixtures.videoId;
const oembed = FetchYoutubeOembed.oembedUrl(`https://www.youtube.com/watch?v=${videoId}`);
const watch = FetchYoutubeTranscript.watchUrl(videoId);

/** YouTube as a Worker sees it: oEmbed answers, the watch page is a consent page. */
const blockedYoutube = {
  [oembed]: { body: Fixtures.oembedVideo, contentType: "application/json" },
  [watch]: { body: Fixtures.consentPage },
};

/** What the model wrote before #147 when it was given nothing. */
const junk: ClassifyLink.ClassificationOutput = {
  tags: ["unclassified", "missing title", "youtube", "unidentified topic"],
  summary:
    "The page text and title were unavailable, so the topic of this YouTube video cannot be determined.",
  type: "video",
  language: "en",
};

const user = { kind: "user" } as const;

/** Saves a link like `POST /links` and enriches every message the save enqueued. */
const saveAndConsume = (input: {
  readonly url: string;
  readonly title?: string;
  readonly tags?: ReadonlyArray<string>;
}) =>
  Effect.gen(function* () {
    const saved = yield* SaveLink.saveLink(
      user,
      Schema.decodeUnknownSync(Link.SaveLinkInput)(input),
    );
    const messages = yield* Testing.TestEnrichmentQueue.use((queue) => queue.drain);
    expect(messages).toEqual([{ linkId: saved.id }]);
    const outcomes = yield* Effect.forEach(messages, (message) =>
      EnrichLink.enrichLink(message.linkId),
    );
    return { id: saved.id, outcome: outcomes[0] };
  });

const row = (id: Link.LinkId) =>
  D1Database.Database.use((db) =>
    db.first(D1Database.sql`SELECT title, summary, type, language, text, image_url AS imageUrl,
      author, enriched_at AS enrichedAt,
      enrichment_error AS enrichmentError FROM links WHERE id = ${id}`),
  ).pipe(Effect.map(Option.getOrThrow));

const tagsOf = (id: Link.LinkId) =>
  D1Database.Database.use((db) =>
    db.all(D1Database.sql`SELECT t.name FROM link_tags lt JOIN tags t ON t.id = lt.tag_id
      WHERE lt.link_id = ${id} ORDER BY t.name`),
  ).pipe(Effect.map((rows) => rows.map((r) => r["name"])));

const keywordSearch = (q: string) =>
  D1Database.Database.use((db) =>
    db.all(D1Database.sql`SELECT links.id FROM links_fts JOIN links ON links.seq = links_fts.rowid
      WHERE links_fts MATCH ${q}`),
  ).pipe(Effect.map((rows) => rows.map((r) => r["id"])));

describe("enrichLink", () => {
  it.effect(
    "saving a link then consuming its message yields tags, summary, vector and R2 text",
    () =>
      Effect.gen(function* () {
        const { id, outcome } = yield* saveAndConsume({ url: articleUrl, tags: ["reading"] });
        expect(outcome).toEqual({ _tag: "Enriched", source: "page" });

        // D1: summary, type, language, enriched_at, the page title and the FTS excerpt.
        const stored = yield* row(id);
        expect(stored).toMatchObject({
          title: "Building a Tiny Parser & Why It Works",
          summary: classification.summary,
          type: "article",
          language: "en",
          enrichmentError: null,
        });
        expect(stored["enrichedAt"]).toMatch(/^\d{4}-\d\d-\d\dT.*Z$/);
        expect(String(stored["text"])).toContain("parser");
        // Tags from the classifier join the tags given on save.
        expect(yield* tagsOf(id)).toEqual(["html", "parsing", "reading", "typescript"]);
        expect(yield* keywordSearch("tiny")).toEqual([id]);
        expect(yield* keywordSearch("summary:walk")).toEqual([id]);

        // R2: the full text.
        const text = yield* StoreText.readText(id);
        expect(Option.getOrThrow(text)).toContain("parser");

        // Vectorize: one vector keyed by the link id, close to the link's content.
        const matches = yield* Vectors.Vectors.use((vectors) =>
          vectors.query(Testing.fakeEmbedding("tiny html parser"), { topK: 5 }),
        );
        expect(matches.map((match) => match.id)).toEqual([id]);
        expect(matches[0]!.score).toBeGreaterThan(0);

        // The classifier saw the page text.
        const [prompt] = yield* FakeLanguageModel.FakeLanguageModel.use((fake) => fake.prompts);
        expect(FakeLanguageModel.promptText(prompt!)).toContain("Source: page");
      }).pipe(
        Effect.provide(
          EnrichmentTestLayer.layer(
            { [articleUrl]: { body: Fixtures.articlePage } },
            classification,
          ),
        ),
      ),
  );

  it.effect("is idempotent: a redelivered message is skipped", () =>
    Effect.gen(function* () {
      const { id } = yield* saveAndConsume({ url: articleUrl });
      const before = yield* row(id);
      expect(yield* EnrichLink.enrichLink(id)).toEqual({ _tag: "Skipped" });
      expect(yield* row(id)).toEqual(before);
      const prompts = yield* FakeLanguageModel.FakeLanguageModel.use((fake) => fake.prompts);
      expect(prompts).toHaveLength(1);
    }).pipe(
      Effect.provide(
        EnrichmentTestLayer.layer({ [articleUrl]: { body: Fixtures.articlePage } }, classification),
      ),
    ),
  );

  it.effect("classifies from the URL when the page cannot be fetched for good", () =>
    Effect.gen(function* () {
      const { id, outcome } = yield* saveAndConsume({ url: "https://example.com/gone" });
      expect(outcome).toEqual({ _tag: "Enriched", source: "none" });
      // Tags and type come from the URL. There is no text, so there is no summary.
      expect(yield* row(id)).toMatchObject({
        summary: null,
        type: "article",
        text: null,
        imageUrl: null,
      });
      expect(yield* tagsOf(id)).toEqual(["html", "parsing", "typescript"]);
      expect(yield* StoreText.readText(id)).toEqual(Option.none());
      const [prompt] = yield* FakeLanguageModel.FakeLanguageModel.use((fake) => fake.prompts);
      expect(FakeLanguageModel.promptText(prompt!)).toContain("Text: (none;");
    }).pipe(
      Effect.provide(
        EnrichmentTestLayer.layer({ "https://example.com/gone": { status: 404 } }, classification),
      ),
    ),
  );

  it.effect("marks a permanent classification failure on the link without failing", () =>
    Effect.gen(function* () {
      const { id, outcome } = yield* saveAndConsume({ url: articleUrl });
      expect(outcome).toEqual({ _tag: "Failed", reason: "classify" });
      expect(yield* row(id)).toMatchObject({
        summary: null,
        enrichedAt: null,
        enrichmentError: "classify: ContentPolicyError",
      });
      // Marked links are skipped from now on.
      expect(yield* EnrichLink.enrichLink(id)).toEqual({ _tag: "Skipped" });
      expect(yield* Vectors.Vectors.use((v) => v.query(Testing.fakeEmbedding("x")))).toEqual([]);
    }).pipe(
      Effect.provide(
        EnrichmentTestLayer.layer(
          { [articleUrl]: { body: Fixtures.articlePage } },
          new AiError.ContentPolicyError({ description: "refused" }),
        ),
      ),
    ),
  );

  it.effect("fails with transient errors after retries, leaving the link for redelivery", () =>
    Effect.gen(function* () {
      const saved = yield* SaveLink.saveLink(
        user,
        Schema.decodeUnknownSync(Link.SaveLinkInput)({ url: articleUrl }),
      );
      const error = yield* Effect.flip(
        EnrichmentTestLayer.noDelays(EnrichLink.enrichLink(saved.id)),
      );
      expect(error._tag).toBe("ClassifyError");
      expect(yield* row(saved.id)).toMatchObject({ enrichedAt: null, enrichmentError: null });
      const prompts = yield* FakeLanguageModel.FakeLanguageModel.use((fake) => fake.prompts);
      expect(prompts).toHaveLength(3);
    }).pipe(
      Effect.provide(
        EnrichmentTestLayer.layer(
          { [articleUrl]: { body: Fixtures.articlePage } },
          new AiError.RateLimitError({}),
        ),
      ),
    ),
  );

  it.effect("fails when the page keeps timing out at the network level", () =>
    Effect.gen(function* () {
      const saved = yield* SaveLink.saveLink(
        user,
        Schema.decodeUnknownSync(Link.SaveLinkInput)({ url: "https://example.com/flaky" }),
      );
      const error = yield* Effect.flip(
        EnrichmentTestLayer.noDelays(EnrichLink.enrichLink(saved.id)),
      );
      expect(error._tag).toBe("ContentFetchError");
    }).pipe(
      Effect.provide(
        EnrichmentTestLayer.layer(
          { "https://example.com/flaky": "transport-error" },
          classification,
        ),
      ),
    ),
  );

  it.effect("a YouTube video behind a consent page gets oEmbed's title, a thumbnail, no junk", () =>
    Effect.gen(function* () {
      const { id, outcome } = yield* saveAndConsume({ url: `https://youtu.be/${videoId}` });
      expect(outcome).toEqual({ _tag: "Enriched", source: "metadata" });
      expect(yield* row(id)).toMatchObject({
        title: "A Synthetic Video, Told by oEmbed",
        summary: null,
        type: "video",
        text: null,
        imageUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        author: "Synthetic Channel",
        enrichmentError: null,
      });
      expect(yield* tagsOf(id)).toEqual(["youtube"]);
      expect(yield* keywordSearch("oEmbed")).toEqual([id]);
      const [prompt] = yield* FakeLanguageModel.FakeLanguageModel.use((fake) => fake.prompts);
      const text = FakeLanguageModel.promptText(prompt!);
      expect(text).toContain("Title: A Synthetic Video, Told by oEmbed");
      expect(text).toContain("Channel: Synthetic Channel");
      expect(text).not.toContain("Before you continue");
    }).pipe(Effect.provide(EnrichmentTestLayer.layer(blockedYoutube, junk))),
  );

  it.effect("replaces a stored title that is only the site name, and keeps a real one", () =>
    Effect.gen(function* () {
      const junkTitled = yield* saveAndConsume({
        url: `https://www.youtube.com/watch?v=${videoId}`,
        title: "- YouTube",
      });
      expect(yield* row(junkTitled.id)).toMatchObject({
        title: "A Synthetic Video, Told by oEmbed",
      });
      const titled = yield* saveAndConsume({ url: articleUrl, title: "My own title" });
      expect(yield* row(titled.id)).toMatchObject({ title: "My own title" });
    }).pipe(
      Effect.provide(
        EnrichmentTestLayer.layer(
          { ...blockedYoutube, [articleUrl]: { body: Fixtures.articlePage } },
          junk,
        ),
      ),
    ),
  );

  it.effect("clears a site-name title when nothing better is known", () =>
    Effect.gen(function* () {
      const { id } = yield* saveAndConsume({
        url: `https://www.youtube.com/watch?v=${videoId}`,
        title: "- YouTube",
      });
      expect(yield* row(id)).toMatchObject({
        title: null,
        summary: null,
        imageUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      });
    }).pipe(
      Effect.provide(
        EnrichmentTestLayer.layer(
          { [oembed]: { status: 404 }, [watch]: { body: Fixtures.consentPage } },
          junk,
        ),
      ),
    ),
  );

  it.effect("never takes a consent page's title for a page that is not a video", () =>
    Effect.gen(function* () {
      const url = "https://www.youtube.com/@synthetic-channel";
      const { id } = yield* saveAndConsume({ url });
      expect(yield* row(id)).toMatchObject({ title: null });
    }).pipe(
      Effect.provide(
        EnrichmentTestLayer.layer(
          { "https://www.youtube.com/@synthetic-channel": { body: Fixtures.consentPage } },
          junk,
        ),
      ),
    ),
  );

  it.effect("stores a page's og:image, and its description when the page has no text", () =>
    Effect.gen(function* () {
      const preview = yield* saveAndConsume({ url: "https://example.com/blog/preview" });
      expect(yield* row(preview.id)).toMatchObject({
        imageUrl: "https://example.com/images/preview.png?v=2",
        author: "Ada Example",
        summary: classification.summary,
      });
      const board = yield* saveAndConsume({ url: "https://example.com/board" });
      expect(board.outcome).toEqual({ _tag: "Enriched", source: "page" });
      expect(yield* row(board.id)).toMatchObject({
        title: "Synthetic Board",
        summary: "A kanban board for small teams.",
        imageUrl: "https://example.com/board.png",
        author: null,
        text: null,
      });
    }).pipe(
      Effect.provide(
        EnrichmentTestLayer.layer(
          {
            "https://example.com/blog/preview": { body: Fixtures.ogImagePage },
            "https://example.com/board": { body: Fixtures.emptyAppPage },
          },
          classification,
        ),
      ),
    ),
  );

  it.effect("repairs a link reset by the migration, and is idempotent after that", () =>
    Effect.gen(function* () {
      // A link as it was stored before #147, then reset the way migration 0006 resets it.
      const { id } = yield* saveAndConsume({ url: `https://youtu.be/${videoId}` });
      yield* D1Database.Database.use((db) =>
        db.run(D1Database.sql`UPDATE links SET title = NULL, summary = NULL, image_url = NULL,
          enriched_at = NULL WHERE id = ${id}`),
      );
      expect(yield* EnrichLink.enrichLink(id)).toEqual({ _tag: "Enriched", source: "metadata" });
      const repaired = yield* row(id);
      expect(repaired).toMatchObject({
        title: "A Synthetic Video, Told by oEmbed",
        summary: null,
        imageUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      });
      expect(yield* EnrichLink.enrichLink(id)).toEqual({ _tag: "Skipped" });
      expect(yield* row(id)).toEqual(repaired);
    }).pipe(Effect.provide(EnrichmentTestLayer.layer(blockedYoutube, junk))),
  );

  it.effect("answers Missing for a link deleted after it was queued", () =>
    Effect.gen(function* () {
      expect(yield* EnrichLink.enrichLink(Link.LinkId.make("link-deleted"))).toEqual({
        _tag: "Missing",
      });
    }).pipe(Effect.provide(EnrichmentTestLayer.layer({}, classification))),
  );
});
