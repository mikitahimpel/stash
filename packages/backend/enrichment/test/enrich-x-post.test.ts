import * as LinksRepo from "@stash/backend-links/links-repo";
import * as SaveLink from "@stash/backend-links/save-link";
import * as D1Database from "@stash/backend-platform/d1-database";
import * as Testing from "@stash/backend-platform/testing";
import * as Vectors from "@stash/backend-platform/vectors";
import * as Link from "@stash/contracts-domain/link";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type * as ClassifyLink from "../src/classify-link.ts";
import * as EnrichLink from "../src/enrich-link.ts";
import * as FetchXPost from "../src/fetch-x-post.ts";
import * as EnrichmentTestLayer from "./enrichment-test-layer.ts";
import * as FakeLanguageModel from "./fake-language-model.ts";
import * as X from "./x-post-fixtures.ts";

const target = { handle: X.handle, id: X.postId };
const postUrl = `https://x.com/${X.handle}/status/${X.postId}`;
const syndication = FetchXPost.syndicationUrl(X.postId);
const oembed = FetchXPost.oembedUrl(target);
const json = "application/json";

const classification: ClassifyLink.ClassificationOutput = {
  tags: ["parsing", "tools"],
  summary: "The model's own words about the post.",
  type: "other",
  language: "en",
};

const save = (url: string, title?: string) =>
  Effect.gen(function* () {
    const saved = yield* SaveLink.saveLink(
      { kind: "user" },
      Schema.decodeUnknownSync(Link.SaveLinkInput)(title === undefined ? { url } : { url, title }),
    );
    yield* Testing.TestEnrichmentQueue.use((queue) => queue.drain);
    return saved.id;
  });

const stored = (id: Link.LinkId) =>
  LinksRepo.LinksRepo.use((repo) => repo.findById(id)).pipe(Effect.map(Option.getOrThrow));

const keywordSearch = (q: string) =>
  D1Database.Database.use((db) =>
    db.all(D1Database.sql`SELECT links.id FROM links_fts JOIN links ON links.seq = links_fts.rowid
      WHERE links_fts MATCH ${q}`),
  ).pipe(Effect.map((rows) => rows.map((r) => r["id"])));

describe("enrichLink: a post on X", () => {
  it.effect("stores the post, names the link after it and keeps its text as the summary", () =>
    Effect.gen(function* () {
      // The extension saved the tab under the title x.com gave it.
      const id = yield* save(
        `https://twitter.com/${X.handle}/status/${X.postId}?s=20`,
        'Example Writer on X: "An example post" / X',
      );
      expect(yield* EnrichLink.enrichLink(id)).toEqual({ _tag: "Enriched", source: "post" });

      const link = yield* stored(id);
      expect(link).toMatchObject({
        canonicalUrl: postUrl,
        title:
          "Example Writer: An example post 🙂 about parsers & tools, see example.com/parsers by @example_reader #parsing $EXMPL",
        // The post itself, not the model's prose about it.
        summary:
          "An example post 🙂 about parsers & tools, see example.com/parsers by @example_reader #parsing $EXMPL",
        author: `@${X.handle}`,
        imageUrl: null,
        language: "en",
        type: "other",
        tags: ["parsing", "tools"],
        post: {
          state: "available",
          id: X.postId,
          url: postUrl,
          author: { name: "Example Writer", handle: X.handle, verified: true },
          counts: { likes: 1234, replies: 56 },
        },
      });

      // Search: the text and the author, by keyword and by meaning.
      expect(yield* keywordSearch("parsers")).toEqual([id]);
      expect(yield* keywordSearch("example_writer")).toEqual([id]);
      const matches = yield* Vectors.Vectors.use((vectors) =>
        vectors.query(Testing.fakeEmbedding("example writer parsers tools"), { topK: 5 }),
      );
      expect(matches.map((match) => match.id)).toEqual([id]);

      // The model tagged the post from its text.
      const [prompt] = yield* FakeLanguageModel.FakeLanguageModel.use((fake) => fake.prompts);
      expect(FakeLanguageModel.promptText(prompt!)).toContain("Source: post");
      expect(FakeLanguageModel.promptText(prompt!)).toContain("about parsers & tools");
    }).pipe(
      Effect.provide(
        EnrichmentTestLayer.layer(
          { [syndication]: { body: X.textPost, contentType: json } },
          classification,
        ),
      ),
    ),
  );

  it.effect("previews a post with media by its first photo", () =>
    Effect.gen(function* () {
      const id = yield* save(postUrl);
      yield* EnrichLink.enrichLink(id);
      const link = yield* stored(id);
      expect(link.imageUrl).toBe("https://pbs.twimg.com/media/Synthetic1.jpg?name=small");
      expect(link.post).toMatchObject({ media: [{ kind: "photo" }, { kind: "photo" }] });
    }).pipe(
      Effect.provide(
        EnrichmentTestLayer.layer(
          { [syndication]: { body: X.photoPost(2), contentType: json } },
          classification,
        ),
      ),
    ),
  );

  it.effect("a long post gets a written summary", () =>
    Effect.gen(function* () {
      const id = yield* save(postUrl);
      yield* EnrichLink.enrichLink(id);
      const link = yield* stored(id);
      expect(link.summary).toBe(classification.summary);
      expect(link.title).toMatch(/^Example Writer: An example sentence about tiny parsers\..*…$/);
      expect(link.post).toMatchObject({ long: true });
    }).pipe(
      Effect.provide(
        EnrichmentTestLayer.layer(
          { [syndication]: { body: X.longPost, contentType: json } },
          classification,
        ),
      ),
    ),
  );

  it.effect(
    "a post that is gone is stored as unavailable, keeps its URL and is not read again",
    () =>
      Effect.gen(function* () {
        const id = yield* save(postUrl, "A title the client gave");
        expect(yield* EnrichLink.enrichLink(id)).toEqual({ _tag: "Enriched", source: "metadata" });
        const link = yield* stored(id);
        expect(link).toMatchObject({
          url: postUrl,
          title: "A title the client gave",
          summary: null,
          author: `@${X.handle}`,
          post: { state: "unavailable", id: X.postId, url: postUrl },
        });
        expect(link.enrichedAt).not.toBeNull();
        expect(yield* EnrichLink.enrichLink(id)).toEqual({ _tag: "Skipped" });
      }).pipe(
        Effect.provide(
          EnrichmentTestLayer.layer(
            {
              [syndication]: { status: 404, body: X.notFoundPage },
              [oembed]: { status: 404, body: X.notFoundPage },
            },
            classification,
            classification,
          ),
        ),
      ),
  );

  it.effect("a post X keeps failing on becomes unavailable on the cron's last requeue", () =>
    Effect.gen(function* () {
      const id = yield* save(postUrl);
      const error = yield* Effect.flip(EnrichLink.enrichLink(id));
      expect(error).toMatchObject({ _tag: "ContentFetchError", isTransient: true });
      expect((yield* stored(id)).enrichedAt).toBeNull();

      yield* D1Database.Database.use((db) =>
        db.run(D1Database.sql`UPDATE links SET enrichment_attempts = 5 WHERE id = ${id}`),
      );
      expect(yield* EnrichLink.enrichLink(id)).toEqual({ _tag: "Enriched", source: "metadata" });
      expect((yield* stored(id)).post).toEqual({
        state: "unavailable",
        id: X.postId,
        url: postUrl,
      });
    }).pipe(
      EnrichmentTestLayer.noDelays,
      Effect.provide(EnrichmentTestLayer.layer({ [syndication]: { status: 503 } }, classification)),
    ),
  );

  it.effect("gives a link saved without a handle the handle's URL once the post is read", () =>
    Effect.gen(function* () {
      yield* D1Database.Database.use((db) =>
        db.exec(`INSERT INTO links (id, url, canonical_url) VALUES
          ('nameless', 'https://x.com/i/status/${X.postId}', 'https://x.com/i/status/${X.postId}')`),
      );
      const id = Link.LinkId.make("nameless");
      yield* EnrichLink.enrichLink(id);
      expect((yield* stored(id)).canonicalUrl).toBe(postUrl);
    }).pipe(
      Effect.provide(
        EnrichmentTestLayer.layer(
          { [syndication]: { body: X.textPost, contentType: json } },
          classification,
          classification,
        ),
      ),
    ),
  );

  it.effect(
    "moves a link saved in an old form to the post's one URL, unless another link has it",
    () =>
      Effect.gen(function* () {
        // Two links as they were stored before posts had one form.
        yield* D1Database.Database.use((db) =>
          db.exec(`INSERT INTO links (id, url, canonical_url) VALUES
          ('old-1', 'https://twitter.com/${X.handle}/status/${X.postId}?s=20',
            'https://twitter.com/${X.handle}/status/${X.postId}?s=20'),
          ('old-2', 'https://mobile.twitter.com/${X.handle}/status/${X.postId}',
            'https://mobile.twitter.com/${X.handle}/status/${X.postId}')`),
        );
        const [first, second] = [Link.LinkId.make("old-1"), Link.LinkId.make("old-2")];
        yield* EnrichLink.enrichLink(first);
        yield* EnrichLink.enrichLink(second);
        expect((yield* stored(first)).canonicalUrl).toBe(postUrl);
        expect((yield* stored(second)).canonicalUrl).toBe(
          `https://mobile.twitter.com/${X.handle}/status/${X.postId}`,
        );
        expect((yield* stored(second)).post).toMatchObject({ state: "available" });
      }).pipe(
        Effect.provide(
          EnrichmentTestLayer.layer(
            { [syndication]: { body: X.textPost, contentType: json } },
            classification,
            classification,
          ),
        ),
      ),
  );
});
