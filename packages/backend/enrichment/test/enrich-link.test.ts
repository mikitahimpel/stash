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

const user = { kind: "user" } as const;

/** Saves a link like `POST /links` and enriches every message the save enqueued. */
const saveAndConsume = (input: { readonly url: string; readonly tags?: ReadonlyArray<string> }) =>
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
    db.first(D1Database.sql`SELECT title, summary, type, language, text, enriched_at AS enrichedAt,
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
      expect(yield* row(id)).toMatchObject({ summary: classification.summary, text: null });
      expect(yield* StoreText.readText(id)).toEqual(Option.none());
      const [prompt] = yield* FakeLanguageModel.FakeLanguageModel.use((fake) => fake.prompts);
      expect(FakeLanguageModel.promptText(prompt!)).toContain("could not be fetched");
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

  it.effect("answers Missing for a link deleted after it was queued", () =>
    Effect.gen(function* () {
      expect(yield* EnrichLink.enrichLink(Link.LinkId.make("link-deleted"))).toEqual({
        _tag: "Missing",
      });
    }).pipe(Effect.provide(EnrichmentTestLayer.layer({}, classification))),
  );
});
