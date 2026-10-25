import * as D1Database from "@stash/backend-platform/d1-database";
import * as Link from "@stash/contracts-domain/link";
import * as Tag from "@stash/contracts-domain/tag";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

/** Narrows a search. Every set field must match. */
export interface SearchFilters {
  readonly type?: Link.LinkType;
  readonly status?: Link.LinkStatus;
  readonly tag?: Tag.TagName;
}

/** A link id with its score in one ranking. Higher ranks first. */
export interface RankedLink {
  readonly linkId: Link.LinkId;
  readonly score: number;
}

/** The tables search reads: `links`, `links_fts`, `link_tags` and `tags`. */
export class SearchRepo extends Context.Service<
  SearchRepo,
  {
    /**
     * Links matching an FTS5 query, best first by bm25 (title weighs most, then summary, then
     * text). `match` must be valid FTS5 syntax.
     */
    readonly keyword: (
      match: string,
      filters: SearchFilters,
      limit: number,
    ) => Effect.Effect<ReadonlyArray<RankedLink>, D1Database.DatabaseError>;
    /** The ids that exist and pass `filters`. */
    readonly filterIds: (
      ids: ReadonlyArray<string>,
      filters: SearchFilters,
    ) => Effect.Effect<ReadonlyArray<Link.LinkId>, D1Database.DatabaseError>;
    /** The links with these ids, keyed by id. Unknown ids are left out. */
    readonly loadLinks: (
      ids: ReadonlyArray<Link.LinkId>,
    ) => Effect.Effect<ReadonlyMap<Link.LinkId, Link.Link>, D1Database.DatabaseError>;
  }
>()("@stash/backend-search/SearchRepo") {}

/** bm25 column weights for `links_fts (title, summary, text)`. */
const bm25 = "bm25(links_fts, 10.0, 4.0, 1.0)";

/** `AND`-joined conditions on the `links` row aliased `l`, with their parameters. */
const filterSql = (filters: SearchFilters): { sql: string; params: Array<D1Database.Value> } => {
  const conditions: Array<string> = [];
  const params: Array<D1Database.Value> = [];
  if (filters.type !== undefined) {
    conditions.push("l.type = ?");
    params.push(filters.type);
  }
  if (filters.status !== undefined) {
    conditions.push("l.status = ?");
    params.push(filters.status);
  }
  if (filters.tag !== undefined) {
    conditions.push(
      "EXISTS (SELECT 1 FROM link_tags AS lt JOIN tags AS t ON t.id = lt.tag_id WHERE lt.link_id = l.id AND t.name = ?)",
    );
    params.push(filters.tag);
  }
  return { sql: conditions.map((condition) => ` AND ${condition}`).join(""), params };
};

const placeholders = (count: number) => Array.from({ length: count }, () => "?").join(", ");

const KeywordRow = Schema.Struct({ linkId: Link.LinkId, rank: Schema.Number });
const IdRow = Schema.Struct({ id: Link.LinkId });

/** A `links` row with its tags as a JSON array, decoded into a `Link`. */
const LinkRow = Schema.Struct({
  ...Link.Link.fields,
  tags: Schema.fromJsonString(Schema.Array(Tag.TagName)),
});

const linkColumns = `l.id, l.url, l.canonical_url AS canonicalUrl, l.title, l.status, l.type,
  l.summary, l.language, l.source_device_id AS sourceDeviceId, l.created_at AS createdAt,
  l.enriched_at AS enrichedAt,
  (SELECT json_group_array(name) FROM (SELECT t.name FROM link_tags AS lt
    JOIN tags AS t ON t.id = lt.tag_id WHERE lt.link_id = l.id ORDER BY t.name)) AS tags`;

export const make = Effect.gen(function* () {
  const db = yield* D1Database.Database;
  const provide = Effect.provideService(D1Database.Database, db);
  return SearchRepo.of({
    keyword: (match, filters, limit) => {
      const filter = filterSql(filters);
      return D1Database.query(KeywordRow)(
        D1Database.statement(
          `SELECT l.id AS linkId, ${bm25} AS rank FROM links_fts
            JOIN links AS l ON l.seq = links_fts.rowid
            WHERE links_fts MATCH ?${filter.sql}
            ORDER BY rank, l.id LIMIT ?`,
          match,
          ...filter.params,
          limit,
        ),
      ).pipe(
        // bm25 is lower for better matches; negate it so higher ranks first.
        Effect.map((rows) => rows.map(({ linkId, rank }) => ({ linkId, score: -rank }))),
        provide,
      );
    },
    filterIds: (ids, filters) => {
      if (ids.length === 0) return Effect.succeed([]);
      const filter = filterSql(filters);
      return D1Database.query(IdRow)(
        D1Database.statement(
          `SELECT l.id FROM links AS l WHERE l.id IN (${placeholders(ids.length)})${filter.sql}`,
          ...ids,
          ...filter.params,
        ),
      ).pipe(
        Effect.map((rows) => rows.map(({ id }) => id)),
        provide,
      );
    },
    loadLinks: (ids) => {
      if (ids.length === 0) return Effect.succeed(new Map());
      return D1Database.query(LinkRow)(
        D1Database.statement(
          `SELECT ${linkColumns} FROM links AS l WHERE l.id IN (${placeholders(ids.length)})`,
          ...ids,
        ),
      ).pipe(
        Effect.map((links) => new Map(links.map((link) => [link.id, link]))),
        provide,
      );
    },
  });
});

/** The repo over the D1 `Database`. */
export const layer: Layer.Layer<SearchRepo, never, D1Database.Database> =
  Layer.effect(SearchRepo)(make);
