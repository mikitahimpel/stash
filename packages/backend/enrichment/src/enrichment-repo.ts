import * as D1Database from "@stash/backend-platform/d1-database";
import * as Link from "@stash/contracts-domain/link";
import type * as Tag from "@stash/contracts-domain/tag";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Option from "effect/Option";
import * as Schema from "effect/Schema";

// The enrichment columns of `links` (summary, type, language, text, enriched_at,
// enrichment_error) and the link's tags. The links feature owns the rest of the table.

/** What enrichment reads about a link. */
export const LinkToEnrich = Schema.Struct({
  id: Link.LinkId,
  url: Schema.String,
  title: Schema.NullOr(Schema.String),
  enrichedAt: Schema.NullOr(Schema.String),
  enrichmentError: Schema.NullOr(Schema.String),
});
export type LinkToEnrich = typeof LinkToEnrich.Type;

/** What a finished enrichment stores. */
export interface Enrichment {
  /** Becomes the link's title only when it has none. */
  readonly title: string | null;
  readonly summary: string;
  /** Becomes the link's type only when it has none, so a type set by hand wins. */
  readonly type: Link.LinkType;
  readonly language: string | null;
  /** The keyword-search excerpt of the text. */
  readonly text: string | null;
  /** Added to the link's tags; tags given on save stay. */
  readonly tags: ReadonlyArray<Tag.TagName>;
  /** UTC ISO 8601. */
  readonly enrichedAt: string;
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
    /** Marks the link as permanently failed, so the consumer skips it from now on. */
    readonly markFailed: (
      id: Link.LinkId,
      reason: string,
    ) => Effect.Effect<void, D1Database.DatabaseError>;
  }
>()("@stash/backend-enrichment/EnrichmentRepo") {}

export const make = Effect.gen(function* () {
  const db = yield* D1Database.Database;
  const provide = Effect.provideService(D1Database.Database, db);
  return EnrichmentRepo.of({
    find: (id) =>
      D1Database.queryFirst(LinkToEnrich)(
        D1Database.sql`SELECT id, url, title, enriched_at AS enrichedAt,
          enrichment_error AS enrichmentError FROM links WHERE id = ${id}`,
      ).pipe(provide),
    save: (id, e) => {
      const tags = JSON.stringify(e.tags);
      return db
        .batch([
          D1Database.sql`UPDATE links SET title = COALESCE(title, ${e.title}),
            summary = ${e.summary}, type = COALESCE(type, ${e.type}), language = ${e.language},
            text = ${e.text}, enriched_at = ${e.enrichedAt}, enrichment_error = NULL
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
    markFailed: (id, reason) =>
      db
        .run(D1Database.sql`UPDATE links SET enrichment_error = ${reason} WHERE id = ${id}`)
        .pipe(Effect.asVoid),
  });
});

export const layer: Layer.Layer<EnrichmentRepo, never, D1Database.Database> =
  Layer.effect(EnrichmentRepo)(make);
