import type * as Ai from "@stash/backend-platform/ai";
import type * as Blobs from "@stash/backend-platform/blobs";
import type * as D1Database from "@stash/backend-platform/d1-database";
import type * as Vectors from "@stash/backend-platform/vectors";
import type * as Link from "@stash/contracts-domain/link";
import type * as LanguageModel from "effect/ai/LanguageModel";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import type * as HttpClient from "effect/http/HttpClient";
import * as Option from "effect/Option";
import * as ClassifyLink from "./classify-link.ts";
import type * as ContentHttp from "./content-http.ts";
import * as ContentText from "./content-text.ts";
import * as EmbedLink from "./embed-link.ts";
import * as EnrichmentRepo from "./enrichment-repo.ts";
import * as FetchContent from "./fetch-content.ts";
import * as StoreText from "./store-text.ts";

// The enrichment pipeline for one link: fetch → classify → embed → store.
//
// - Idempotent: a link that is already enriched (or marked failed) is skipped, and every write is
//   an upsert. The D1 row is written last, so a delivery that dies halfway is simply redone.
// - Transient failures (timeouts, rate limits, outages, D1 / R2 / Vectorize errors) are retried
//   in place on a `Schedule` (see `ContentHttp.FetchPolicy` and `EnrichPolicy`) and then fail, so
//   the queue delivers the message again.
// - Permanent failures never fail: content that cannot be fetched (404, a PDF, …) is classified
//   from its URL and title, and a classification the model refuses or cannot produce marks the
//   link with `enrichment_error`.

/** The keyword-search excerpt kept in `links.text`. The full text is in R2. */
export const maxSearchTextLength = 20_000;

/** The longest title taken from a page (the `LinkTitle` limit). */
export const maxTitleLength = 1_000;

export type Outcome =
  /** Enriched and stored. */
  | { readonly _tag: "Enriched"; readonly source: ContentText.ContentText["source"] | "none" }
  /** Enriched earlier, or failed permanently earlier. */
  | { readonly _tag: "Skipped" }
  /** No such link: it was deleted after it was queued. */
  | { readonly _tag: "Missing" }
  /** Failed permanently and marked as failed. */
  | { readonly _tag: "Failed"; readonly reason: string };

/** A transient failure: the message should be delivered again. */
export type EnrichError =
  | ContentHttp.ContentFetchError
  | ClassifyLink.ClassifyError
  | Ai.AiError
  | Vectors.VectorsError
  | Blobs.BlobsError
  | D1Database.DatabaseError;

export type Requirements =
  | EnrichmentRepo.EnrichmentRepo
  | HttpClient.HttpClient
  | LanguageModel.LanguageModel
  | Ai.Ai
  | Vectors.Vectors
  | Blobs.Blobs;

const fetchContent = (url: string) =>
  FetchContent.fetchContent(url).pipe(
    Effect.map(Option.some),
    Effect.catchIf(
      (error) => !error.isTransient,
      (error) =>
        Effect.as(
          Effect.logWarning(`enrichment: no content for ${url} (${error.reason})`),
          Option.none<ContentText.ContentText>(),
        ),
    ),
  );

/** Enriches one link. Fails only with transient errors; see the comment at the top. */
export const enrichLink = (id: Link.LinkId): Effect.Effect<Outcome, EnrichError, Requirements> =>
  Effect.gen(function* () {
    const repo = yield* EnrichmentRepo.EnrichmentRepo;
    const found = yield* repo.find(id);
    if (Option.isNone(found)) return { _tag: "Missing" } as const;
    const link = found.value;
    if (link.enrichedAt !== null || link.enrichmentError !== null) {
      return { _tag: "Skipped" } as const;
    }

    const content = yield* fetchContent(link.url);
    const text = Option.match(content, { onNone: () => "", onSome: (c) => c.text });
    if (text !== "") yield* StoreText.storeText(id, text);

    const title = Option.fromNullishOr(link.title).pipe(
      Option.orElse(() => Option.flatMap(content, (c) => c.title)),
      Option.map((t) => ContentText.truncate(t, maxTitleLength)),
    );
    const classified = yield* ClassifyLink.classifyLink({ url: link.url, title, content }).pipe(
      Effect.map(Option.some),
      Effect.catchIf(
        (error) => error.permanent,
        (error) => {
          const reason = `classify: ${error.cause.reason._tag}`;
          return repo
            .markFailed(id, reason)
            .pipe(
              Effect.andThen(Effect.logWarning(`enrichment: ${id} failed permanently (${reason})`)),
              Effect.as(Option.none<ClassifyLink.Classification>()),
            );
        },
      ),
    );
    if (Option.isNone(classified)) {
      return { _tag: "Failed", reason: "classify" } as const;
    }
    const classification = classified.value;

    yield* EmbedLink.embedLink(id, {
      title,
      summary: classification.summary,
      tags: classification.tags,
      text,
    });

    const now = yield* DateTime.now;
    yield* repo.save(id, {
      title: Option.getOrNull(title),
      summary: classification.summary,
      type: classification.type,
      language: Option.getOrNull(
        Option.orElse(classification.language, () => Option.flatMap(content, (c) => c.language)),
      ),
      text: text === "" ? null : ContentText.truncate(text, maxSearchTextLength),
      tags: classification.tags,
      enrichedAt: DateTime.formatIso(now),
    });
    return {
      _tag: "Enriched",
      source: Option.match(content, { onNone: () => "none" as const, onSome: (c) => c.source }),
    } as const;
  }).pipe(Effect.withSpan("enrichLink", { attributes: { linkId: id } }));
