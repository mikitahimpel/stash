import type * as D1Database from "@stash/backend-platform/d1-database";
import * as Link from "@stash/contracts-domain/link";
import * as Effect from "effect/Effect";
import type * as HttpClient from "effect/http/HttpClient";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type * as ContentHttp from "./content-http.ts";
import type * as ContentText from "./content-text.ts";
import * as EnrichPolicy from "./enrich-policy.ts";
import * as EnrichmentRepo from "./enrichment-repo.ts";
import * as FetchContent from "./fetch-content.ts";

// The metadata backfill for one link (#155): a link enriched before enrichment knew about preview
// images and authors gets them now, and nothing else about it changes.
//
// - Only metadata is fetched: one oEmbed request for a YouTube link (its thumbnail comes from the
//   video id), the page for any other. No classifier call, no embedding, no text.
// - Only missing fields are filled. A stored image or author stays, and the title, summary, type
//   and tags are never touched.
// - Once per metadata version: a finished backfill stamps `EnrichPolicy.metadataVersion` on the
//   link, found or not, so the cron does not take it again (see `requeue-backfill.ts`) and a
//   duplicate message is skipped.
// - Transient failures (timeouts, 429, 5xx, D1 errors) fail, so the queue delivers the message
//   again. That does not go on forever: on the cron's last requeue nothing is fetched, the link
//   gets what its URL alone gives (a video's thumbnail) and is done.
// - A site that answers for good with nothing useful (404, a PDF) finishes the backfill too.

export type Outcome =
  /** Read and stamped. `filled` names the fields that were missing and are now set. */
  | { readonly _tag: "Backfilled"; readonly filled: ReadonlyArray<"imageUrl" | "author"> }
  /** Not enriched yet (enrichment will read the metadata itself), complete, or read already. */
  | { readonly _tag: "Skipped" }
  /** No such link: it was deleted after it was queued. */
  | { readonly _tag: "Missing" };

/** A transient failure: the message should be delivered again. */
export type BackfillError = ContentHttp.ContentFetchError | D1Database.DatabaseError;

export type Requirements = EnrichmentRepo.EnrichmentRepo | HttpClient.HttpClient;

const decodeUrl = Schema.decodeUnknownOption(Link.Url);
const decodeAuthor = Schema.decodeUnknownOption(Link.LinkAuthor);

const fetchMetadata = (url: string) =>
  FetchContent.fetchMetadata(url).pipe(
    Effect.map(Option.some),
    Effect.catchIf(
      (error) => !error.isTransient,
      (error) =>
        Effect.as(
          Effect.logWarning(`backfill: no metadata for ${url} (${error.reason})`),
          Option.none<ContentText.ContentText>(),
        ),
    ),
  );

/** Whether the cron should take the link for a backfill, and the consumer should run it. */
export const isDue = (link: EnrichmentRepo.LinkToEnrich): boolean =>
  link.enrichedAt !== null &&
  (link.imageUrl === null || link.author === null) &&
  link.metadataVersion < EnrichPolicy.metadataVersion;

/** Fills one link's missing image and author. Fails only with transient errors. */
export const backfillMetadata = (
  id: Link.LinkId,
): Effect.Effect<Outcome, BackfillError, Requirements> =>
  Effect.gen(function* () {
    const repo = yield* EnrichmentRepo.EnrichmentRepo;
    const found = yield* repo.find(id);
    if (Option.isNone(found)) return { _tag: "Missing" } as const;
    const link = found.value;
    if (!isDue(link)) return { _tag: "Skipped" } as const;

    // The cron's last requeue: stop fetching, so the link is done whatever its site answers.
    const policy = yield* EnrichPolicy.EnrichPolicy;
    const content =
      link.enrichmentAttempts >= policy.maxRequeues
        ? FetchContent.withoutFetch(link.url)
        : yield* fetchMetadata(link.url);
    const imageUrl = content.pipe(
      Option.flatMap((c) => c.imageUrl),
      Option.flatMap(decodeUrl),
      Option.getOrNull,
    );
    const author = content.pipe(
      Option.flatMap((c) => c.author),
      Option.flatMap(decodeAuthor),
      Option.getOrNull,
    );
    yield* repo.saveMetadata(id, {
      imageUrl,
      author,
      metadataVersion: EnrichPolicy.metadataVersion,
    });
    const filled: Array<"imageUrl" | "author"> = [];
    if (link.imageUrl === null && imageUrl !== null) filled.push("imageUrl");
    if (link.author === null && author !== null) filled.push("author");
    return { _tag: "Backfilled", filled } as const;
  }).pipe(Effect.withSpan("backfillMetadata", { attributes: { linkId: id } }));
