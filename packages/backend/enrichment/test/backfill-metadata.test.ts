import * as D1Database from "@stash/backend-platform/d1-database";
import * as Testing from "@stash/backend-platform/testing";
import * as Link from "@stash/contracts-domain/link";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as BackfillMetadata from "../src/backfill-metadata.ts";
import * as EnrichLink from "../src/enrich-link.ts";
import * as EnrichPolicy from "../src/enrich-policy.ts";
import * as FetchYoutubeOembed from "../src/fetch-youtube-oembed.ts";
import * as RequeueBackfill from "../src/requeue-backfill.ts";
import * as EnrichmentTestLayer from "./enrichment-test-layer.ts";
import * as FakeHttp from "./fake-http.ts";
import * as Fixtures from "./fixtures.ts";

const videoId = Fixtures.videoId;
const oembed = FetchYoutubeOembed.oembedUrl(`https://www.youtube.com/watch?v=${videoId}`);
const thumbnail = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
const answeringOembed = {
  [oembed]: { body: Fixtures.oembedVideo, contentType: "application/json" },
};
const githubUrl = "https://github.com/synthetic-owner/synthetic-repo";
const huggingFaceUrl = "https://huggingface.co/spaces/synthetic-owner/synthetic-space";
const enrichedAt = "2026-03-10T00:01:00.000Z";

/** A link as an enrichment before #147 / #148 left it: enriched, no image, no author. */
const insertEnriched = (
  id: string,
  url: string,
  extra: { readonly imageUrl?: string; readonly author?: string } = {},
) =>
  D1Database.Database.use((db) =>
    db.batch([
      D1Database.sql`INSERT INTO links (id, url, title, summary, type, language, text, image_url,
          author, created_at, enriched_at)
        VALUES (${id}, ${url}, 'A good title', 'A good summary.', 'video', 'en', 'Some text',
          ${extra.imageUrl ?? null}, ${extra.author ?? null}, '2026-03-10T00:00:00.000Z',
          ${enrichedAt})`,
      D1Database.sql`INSERT OR IGNORE INTO tags (name) VALUES ('economics')`,
      D1Database.sql`INSERT INTO link_tags (link_id, tag_id)
        SELECT ${id}, id FROM tags WHERE name = 'economics'`,
    ]),
  ).pipe(Effect.as(Link.LinkId.make(id)));

const row = (id: Link.LinkId) =>
  D1Database.Database.use((db) =>
    db.first(D1Database.sql`SELECT title, summary, type, language, text, image_url AS imageUrl,
      author, enriched_at AS enrichedAt, enrichment_attempts AS attempts,
      metadata_version AS metadataVersion,
      (SELECT group_concat(t.name) FROM link_tags lt JOIN tags t ON t.id = lt.tag_id
        WHERE lt.link_id = links.id) AS tags
      FROM links WHERE id = ${id}`),
  ).pipe(Effect.map(Option.getOrThrow));

const requestedUrls = FakeHttp.FakeHttp.use((http) => http.requests).pipe(
  Effect.map((requests) => requests.map((request) => request.url)),
);

const drained = Testing.TestEnrichmentQueue.use((queue) => queue.drain);

/** One hour of the cron and the consumer: requeue, then run every message. */
const runHour = Effect.gen(function* () {
  yield* RequeueBackfill.requeueBackfill();
  const messages = yield* drained;
  for (const message of messages) expect(message.task).toBe("metadata");
  return yield* Effect.forEach(messages, (message) =>
    BackfillMetadata.backfillMetadata(message.linkId).pipe(
      EnrichmentTestLayer.noDelays,
      Effect.result,
    ),
  );
});

/** Every form of a video URL a link may have been saved with. */
const youtubeForms: ReadonlyArray<readonly [string, string]> = [
  ["a watch URL", `https://www.youtube.com/watch?v=${videoId}`],
  ["youtu.be", `https://youtu.be/${videoId}?si=abc`],
  ["a live stream", `https://www.youtube.com/live/${videoId}?feature=share`],
  ["a Short", `https://www.youtube.com/shorts/${videoId}`],
];

describe("backfillMetadata", () => {
  it.effect.each(youtubeForms)(
    "fills a YouTube video's channel and thumbnail from oEmbed alone: %s",
    ([, url]) =>
      Effect.gen(function* () {
        const id = yield* insertEnriched("video", url);
        expect(yield* BackfillMetadata.backfillMetadata(id)).toEqual({
          _tag: "Backfilled",
          filled: ["imageUrl", "author"],
        });
        // Only the two fields and the stamp changed.
        expect(yield* row(id)).toEqual({
          title: "A good title",
          summary: "A good summary.",
          type: "video",
          language: "en",
          text: "Some text",
          imageUrl: thumbnail,
          author: "Synthetic Channel",
          enrichedAt,
          attempts: 0,
          metadataVersion: EnrichPolicy.metadataVersion,
          tags: "economics",
        });
        // One request: oEmbed. Never the watch page.
        expect(yield* requestedUrls).toEqual([oembed]);
      }).pipe(Effect.provide(EnrichmentTestLayer.layer(answeringOembed))),
  );

  it.effect("fills a page's og:image and author, and keeps a value already stored", () =>
    Effect.gen(function* () {
      const bare = yield* insertEnriched("bare", "https://example.com/blog/preview");
      const withImage = yield* insertEnriched("with-image", "https://example.com/blog/preview", {
        imageUrl: "https://example.com/kept.png",
      });
      expect(yield* BackfillMetadata.backfillMetadata(bare)).toEqual({
        _tag: "Backfilled",
        filled: ["imageUrl", "author"],
      });
      expect(yield* BackfillMetadata.backfillMetadata(withImage)).toEqual({
        _tag: "Backfilled",
        filled: ["author"],
      });
      expect(yield* row(bare)).toMatchObject({
        title: "A good title",
        summary: "A good summary.",
        imageUrl: "https://example.com/images/preview.png?v=2",
        author: "Ada Example",
      });
      expect(yield* row(withImage)).toMatchObject({
        imageUrl: "https://example.com/kept.png",
        author: "Ada Example",
      });
      // One event per filled link, with the link as it is now.
      const events = yield* Testing.TestLinkEvents.use((stream) => stream.published);
      expect(events.map((event) => event.type === "link.updated" && event.link.author)).toEqual([
        "Ada Example",
        "Ada Example",
      ]);
    }).pipe(
      Effect.provide(
        EnrichmentTestLayer.layer({
          "https://example.com/blog/preview": { body: Fixtures.ogImagePage },
        }),
      ),
    ),
  );

  it.effect("fills the social card of a GitHub repository and of a Hugging Face Space", () =>
    Effect.gen(function* () {
      const repo = yield* insertEnriched("repo", githubUrl);
      const space = yield* insertEnriched("space", huggingFaceUrl);
      expect(yield* BackfillMetadata.backfillMetadata(repo)).toEqual({
        _tag: "Backfilled",
        filled: ["imageUrl"],
      });
      expect(yield* BackfillMetadata.backfillMetadata(space)).toEqual({
        _tag: "Backfilled",
        filled: ["imageUrl"],
      });
      expect(yield* row(repo)).toMatchObject({
        title: "A good title",
        summary: "A good summary.",
        imageUrl: Fixtures.githubRepoImage,
        author: null,
        metadataVersion: EnrichPolicy.metadataVersion,
      });
      expect(yield* row(space)).toMatchObject({ imageUrl: Fixtures.huggingFaceSpaceImage });
      // Read once: the cron has nothing left to send.
      expect(yield* RequeueBackfill.requeueBackfill()).toBe(0);
    }).pipe(
      Effect.provide(
        EnrichmentTestLayer.layer({
          [githubUrl]: { body: Fixtures.githubRepoPage },
          [huggingFaceUrl]: { body: Fixtures.huggingFaceSpacePage },
        }),
      ),
    ),
  );

  it.effect("is idempotent: a second message is skipped without a request", () =>
    Effect.gen(function* () {
      const id = yield* insertEnriched("video", `https://youtu.be/${videoId}`);
      yield* BackfillMetadata.backfillMetadata(id);
      const before = yield* row(id);
      const requests = (yield* requestedUrls).length;
      expect(yield* BackfillMetadata.backfillMetadata(id)).toEqual({ _tag: "Skipped" });
      expect(yield* row(id)).toEqual(before);
      expect((yield* requestedUrls).length).toBe(requests);
    }).pipe(Effect.provide(EnrichmentTestLayer.layer(answeringOembed))),
  );

  it.effect("leaves a pending link to enrichment, and answers Missing for a deleted one", () =>
    Effect.gen(function* () {
      yield* D1Database.Database.use((db) =>
        db.run(D1Database.sql`INSERT INTO links (id, url, created_at)
          VALUES ('pending', 'https://example.com/pending', '2026-03-10T00:00:00.000Z')`),
      );
      expect(yield* BackfillMetadata.backfillMetadata(Link.LinkId.make("pending"))).toEqual({
        _tag: "Skipped",
      });
      expect(yield* BackfillMetadata.backfillMetadata(Link.LinkId.make("gone"))).toEqual({
        _tag: "Missing",
      });
      expect(yield* requestedUrls).toEqual([]);
    }).pipe(Effect.provide(EnrichmentTestLayer.layer({}))),
  );

  it.effect("finishes a link whose page is gone for good, with nothing filled", () =>
    Effect.gen(function* () {
      const id = yield* insertEnriched("gone-page", "https://example.com/gone");
      expect(yield* BackfillMetadata.backfillMetadata(id)).toEqual({
        _tag: "Backfilled",
        filled: [],
      });
      expect(yield* row(id)).toMatchObject({
        imageUrl: null,
        author: null,
        metadataVersion: EnrichPolicy.metadataVersion,
      });
      // Nothing a client shows changed, so nothing is published.
      expect(yield* Testing.TestLinkEvents.use((stream) => stream.published)).toEqual([]);
    }).pipe(
      Effect.provide(EnrichmentTestLayer.layer({ "https://example.com/gone": { status: 404 } })),
    ),
  );
});

describe("requeueBackfill", () => {
  it.effect("takes only enriched links that miss a field and were not read yet", () =>
    Effect.gen(function* () {
      yield* insertEnriched("no-fields", "https://example.com/a");
      yield* insertEnriched("no-author", "https://example.com/b", {
        imageUrl: "https://example.com/b.png",
      });
      yield* insertEnriched("complete", "https://example.com/c", {
        imageUrl: "https://example.com/c.png",
        author: "Ada Example",
      });
      yield* insertEnriched("read-already", "https://example.com/d");
      yield* D1Database.Database.use((db) =>
        db.batch([
          D1Database.sql`UPDATE links SET metadata_version = ${EnrichPolicy.metadataVersion}
            WHERE id = 'read-already'`,
          D1Database.sql`INSERT INTO links (id, url, created_at)
            VALUES ('pending', 'https://example.com/e', '2026-03-10T00:00:00.000Z')`,
          D1Database.sql`INSERT INTO links (id, url, created_at, enrichment_error)
            VALUES ('failed', 'https://example.com/f', '2026-03-10T00:00:00.000Z', 'classify')`,
        ]),
      );
      expect(yield* RequeueBackfill.requeueBackfill()).toBe(2);
      const messages = yield* drained;
      expect(messages.map((message) => message.linkId).sort()).toEqual(["no-author", "no-fields"]);
      expect(messages.every((message) => message.task === "metadata")).toBe(true);
    }).pipe(Effect.provide(EnrichmentTestLayer.layer({}))),
  );

  it.effect("sends at most `limit` links a run, and nothing once every link was read", () =>
    Effect.gen(function* () {
      for (const name of ["a", "b", "c"]) {
        yield* insertEnriched(name, `https://example.com/gone/${name}`);
      }
      expect(yield* RequeueBackfill.requeueBackfill({ limit: 2 })).toBe(2);
      expect(yield* drained).toHaveLength(2);

      // Every page is a 404, so no link gets an image. Each is still read exactly once.
      let read = 0;
      for (let hour = 0; hour < 10; hour++) read += (yield* runHour).length;
      expect(read).toBe(3);
      expect(yield* RequeueBackfill.requeueBackfill()).toBe(0);
      expect(yield* drained).toEqual([]);
      const requests = yield* requestedUrls;
      expect(requests).toHaveLength(3);
    }).pipe(
      Effect.provide(
        EnrichmentTestLayer.layer({
          "https://example.com/gone/a": { status: 404 },
          "https://example.com/gone/b": { status: 404 },
          "https://example.com/gone/c": { status: 404 },
        }),
      ),
    ),
  );

  it.effect(
    "stops at the attempt cap: the last requeue fetches nothing and finishes the link",
    () =>
      Effect.gen(function* () {
        const video = yield* insertEnriched("video", `https://youtu.be/${videoId}`);
        const page = yield* insertEnriched("page", "https://example.com/down");
        const { maxRequeues } = EnrichPolicy.defaultPolicy;
        // Every hour but the last: both fail transiently and stay due.
        for (let hour = 1; hour < maxRequeues; hour++) {
          const results = yield* runHour;
          expect(results.map((result) => result._tag)).toEqual(["Failure", "Failure"]);
        }
        const fetches = (yield* requestedUrls).length;
        // The last requeue: no request. The video gets its thumbnail by id, the page nothing.
        const last = yield* runHour;
        expect(last.map((result) => result._tag)).toEqual(["Success", "Success"]);
        expect((yield* requestedUrls).length).toBe(fetches);
        expect(yield* row(video)).toMatchObject({
          imageUrl: thumbnail,
          author: null,
          attempts: 0,
          metadataVersion: EnrichPolicy.metadataVersion,
          title: "A good title",
        });
        expect(yield* row(page)).toMatchObject({
          imageUrl: null,
          author: null,
          metadataVersion: EnrichPolicy.metadataVersion,
        });
        expect(yield* runHour).toEqual([]);
      }).pipe(
        Effect.provide(
          EnrichmentTestLayer.layer({
            [oembed]: { status: 503 },
            "https://example.com/down": { status: 503 },
          }),
        ),
      ),
  );

  it.effect("never sends a link whose backfill fails even without a fetch more than the cap", () =>
    Effect.gen(function* () {
      yield* insertEnriched("stuck", "https://example.com/down");
      const { maxRequeues } = EnrichPolicy.defaultPolicy;
      let sent = 0;
      // The consumer never runs (the queue loses every message).
      for (let hour = 0; hour < maxRequeues + 5; hour++) {
        sent += yield* RequeueBackfill.requeueBackfill();
        yield* drained;
      }
      expect(sent).toBe(maxRequeues);
    }).pipe(Effect.provide(EnrichmentTestLayer.layer({}))),
  );

  it.effect("a link enriched now is stamped, so it is not read again for a missing author", () =>
    Effect.gen(function* () {
      yield* D1Database.Database.use((db) =>
        db.run(D1Database.sql`INSERT INTO links (id, url, created_at)
          VALUES ('fresh', 'https://example.com/board', '2026-03-10T00:00:00.000Z')`),
      );
      const id = Link.LinkId.make("fresh");
      expect(yield* EnrichLink.enrichLink(id)).toEqual({ _tag: "Enriched", source: "page" });
      expect(yield* row(id)).toMatchObject({
        author: null,
        metadataVersion: EnrichPolicy.metadataVersion,
      });
      expect(yield* RequeueBackfill.requeueBackfill()).toBe(0);
    }).pipe(
      Effect.provide(
        EnrichmentTestLayer.layer(
          { "https://example.com/board": { body: Fixtures.emptyAppPage } },
          { tags: ["boards"], summary: "", type: "tool", language: "en" },
        ),
      ),
    ),
  );
});
