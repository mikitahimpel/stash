import * as D1Database from "@stash/backend-platform/d1-database";
import * as Link from "@stash/contracts-domain/link";
import type * as Tag from "@stash/contracts-domain/tag";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Option from "effect/Option";
import * as Schema from "effect/Schema";

// The enrichment columns of `links` (summary, type, language, text, image_url, author, enriched_at,
// enrichment_error, enrichment_attempts, metadata_version) and the link's tags. The links feature owns the rest of the table.

/** What enrichment reads about a link. */
export const LinkToEnrich = Schema.Struct({
  id: Link.LinkId,
  url: Schema.String,
  title: Schema.NullOr(Schema.String),
  enrichedAt: Schema.NullOr(Schema.String),
  enrichmentError: Schema.NullOr(Schema.String),
  /** How many times the cron sent the link to the queue again. */
  enrichmentAttempts: Schema.Int,
  imageUrl: Schema.NullOr(Schema.String),
  author: Schema.NullOr(Schema.String),
  /** The metadata version the link was last read for (`EnrichPolicy.metadataVersion`). */
  metadataVersion: Schema.Int,
});
export type LinkToEnrich = typeof LinkToEnrich.Type;

/** What a finished enrichment stores. */
export interface Enrichment {
  /** Becomes the link's title only when it has none, or has `staleTitle`. */
  readonly title: string | null;
  /**
   * The stored title when it is junk (a bare site name such as "- YouTube"): `title` replaces it,
   * even with `null`. A title set since enrichment read the link stays.
   */
  readonly staleTitle: string | null;
  /** `null` when there was nothing to summarize. */
  readonly summary: string | null;
  /** Becomes the link's type only when it has none, so a type set by hand wins. */
  readonly type: Link.LinkType;
  readonly language: string | null;
  /** The preview image. `null` keeps the one already stored. */
  readonly imageUrl: Link.Url | null;
  /** The channel or author. `null` keeps the one already stored. */
  readonly author: string | null;
  /** The keyword-search excerpt of the text. */
  readonly text: string | null;
  /** Added to the link's tags; tags given on save stay. */
  readonly tags: ReadonlyArray<Tag.TagName>;
  /** UTC ISO 8601. */
  readonly enrichedAt: string;
  /** The metadata version this enrichment read (`EnrichPolicy.metadataVersion`). */
  readonly metadataVersion: number;
}

/** What a metadata backfill stores. */
export interface Metadata {
  /** Fills the preview image only when the link has none. */
  readonly imageUrl: Link.Url | null;
  /** Fills the author only when the link has none. */
  readonly author: string | null;
  /** The metadata version that was read. With it the link is not taken again. */
  readonly metadataVersion: number;
}

export class EnrichmentRepo extends Context.Service<
  EnrichmentRepo,
  {
    readonly find: (
      id: Link.LinkId,
    ) => Effect.Effect<Option.Option<LinkToEnrich>, D1Database.DatabaseError>;
    /** Stores the enrichment and clears any earlier failure, in one transaction. */
    readonly save: (
      id: Link.LinkId,
      enrichment: Enrichment,
    ) => Effect.Effect<void, D1Database.DatabaseError>;
    /**
     * Takes up to `limit` links saved before `before` (UTC ISO 8601) that are neither enriched
     * nor marked failed and were taken fewer than `maxRequeues` times, and counts the take on
     * each (`enrichment_attempts`). Random order, so no link can starve the others.
     */
    readonly takePending: (options: {
      readonly before: string;
      readonly limit: number;
      readonly maxRequeues: number;
    }) => Effect.Effect<ReadonlyArray<Link.LinkId>, D1Database.DatabaseError>;
    /**
     * Takes up to `limit` enriched links that miss their image or their author, were last read
     * for a metadata version before `metadataVersion` and were taken fewer than `maxRequeues`
     * times, and counts the take on each (`enrichment_attempts`). Random order.
     */
    readonly takeBackfill: (options: {
      readonly metadataVersion: number;
      readonly limit: number;
      readonly maxRequeues: number;
    }) => Effect.Effect<ReadonlyArray<Link.LinkId>, D1Database.DatabaseError>;
    /**
     * Fills the missing image and author of an enriched link and stamps the metadata version.
     * Nothing else changes: values already stored stay, and so do the title, summary and tags.
     */
    readonly saveMetadata: (
      id: Link.LinkId,
      metadata: Metadata,
    ) => Effect.Effect<void, D1Database.DatabaseError>;
    /** Marks the link as permanently failed, so the consumer skips it from now on. */
    readonly markFailed: (
      id: Link.LinkId,
      reason: string,
    ) => Effect.Effect<void, D1Database.DatabaseError>;
  }
>()("@stash/backend-enrichment/EnrichmentRepo") {}

const PendingRow = Schema.Struct({ id: Link.LinkId });

export const make = Effect.gen(function* () {
  const db = yield* D1Database.Database;
  const provide = Effect.provideService(D1Database.Database, db);
  const countTake = (ids: ReadonlyArray<Link.LinkId>) =>
    ids.length === 0
      ? Effect.succeed(ids)
      : db
          .run(
            D1Database.sql`UPDATE links SET enrichment_attempts = enrichment_attempts + 1
              WHERE id IN (SELECT value FROM json_each(${JSON.stringify(ids)}))`,
          )
          .pipe(Effect.as(ids));
  return EnrichmentRepo.of({
    find: (id) =>
      D1Database.queryFirst(LinkToEnrich)(
        D1Database.sql`SELECT id, url, title, enriched_at AS enrichedAt,
          enrichment_error AS enrichmentError, enrichment_attempts AS enrichmentAttempts,
          image_url AS imageUrl, author, metadata_version AS metadataVersion
          FROM links WHERE id = ${id}`,
      ).pipe(provide),
    save: (id, e) => {
      const tags = JSON.stringify(e.tags);
      return db
        .batch([
          D1Database.sql`UPDATE links SET
            title = CASE WHEN title IS NULL OR title = ${e.staleTitle} THEN ${e.title}
              ELSE title END,
            summary = ${e.summary}, type = COALESCE(type, ${e.type}), language = ${e.language},
            text = ${e.text}, image_url = COALESCE(${e.imageUrl}, image_url),
            author = COALESCE(${e.author}, author), enriched_at = ${e.enrichedAt},
            enrichment_error = NULL, enrichment_attempts = 0,
            metadata_version = ${e.metadataVersion}
            WHERE id = ${id}`,
          D1Database.sql`INSERT OR IGNORE INTO tags (name)
            SELECT DISTINCT value FROM json_each(${tags})
            WHERE EXISTS (SELECT 1 FROM links WHERE id = ${id})`,
          D1Database.sql`INSERT OR IGNORE INTO link_tags (link_id, tag_id)
            SELECT ${id}, tags.id FROM json_each(${tags}) AS t JOIN tags ON tags.name = t.value
            WHERE EXISTS (SELECT 1 FROM links WHERE id = ${id})`,
        ])
        .pipe(Effect.asVoid);
    },
    takePending: Effect.fn("EnrichmentRepo.takePending")(function* (options) {
      const rows = yield* D1Database.query(PendingRow)(
        D1Database.sql`SELECT id FROM links WHERE enriched_at IS NULL AND enrichment_error IS NULL
          AND created_at < ${options.before} AND enrichment_attempts < ${options.maxRequeues}
          ORDER BY random() LIMIT ${options.limit}`,
      ).pipe(provide);
      return yield* countTake(rows.map((row) => row.id));
    }),
    takeBackfill: Effect.fn("EnrichmentRepo.takeBackfill")(function* (options) {
      const rows = yield* D1Database.query(PendingRow)(
        D1Database.sql`SELECT id FROM links WHERE enriched_at IS NOT NULL
          AND (image_url IS NULL OR author IS NULL)
          AND metadata_version < ${options.metadataVersion}
          AND enrichment_attempts < ${options.maxRequeues}
          ORDER BY random() LIMIT ${options.limit}`,
      ).pipe(provide);
      return yield* countTake(rows.map((row) => row.id));
    }),
    saveMetadata: (id, m) =>
      db
        .run(
          D1Database.sql`UPDATE links SET image_url = COALESCE(image_url, ${m.imageUrl}),
            author = COALESCE(author, ${m.author}), metadata_version = ${m.metadataVersion},
            enrichment_attempts = 0
            WHERE id = ${id} AND enriched_at IS NOT NULL`,
        )
        .pipe(Effect.asVoid),
    markFailed: (id, reason) =>
      db
        .run(D1Database.sql`UPDATE links SET enrichment_error = ${reason} WHERE id = ${id}`)
        .pipe(Effect.asVoid),
  });
});

export const layer: Layer.Layer<EnrichmentRepo, never, D1Database.Database> =
  Layer.effect(EnrichmentRepo)(make);
