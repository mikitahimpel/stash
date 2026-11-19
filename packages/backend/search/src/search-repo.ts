import * as D1Database from "@stash/backend-platform/d1-database";
import * as Security from "@stash/contracts-api/security";
import type * as Device from "@stash/contracts-domain/device";
import * as Link from "@stash/contracts-domain/link";
import * as Tag from "@stash/contracts-domain/tag";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

/** Narrows a search. Every set field must match. */
export interface SearchFilters {
  readonly type?: Link.LinkType;
  readonly status?: Link.LinkStatus;
  readonly tag?: Tag.TagName;
  /** The device the link was saved from. */
  readonly deviceId?: Device.DeviceId;
  /** Saved at or after this moment. */
  readonly since?: DateTime.Utc;
}

/** A link id with its score in one ranking. Higher ranks first. */
export interface RankedLink {
  readonly linkId: Link.LinkId;
  readonly score: number;
}

/**
 * The tables search reads: `links`, `links_fts`, `link_tags` and `tags`. Every method reads only
 * the current user's links (`CurrentUser`).
 */
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
    ) => Effect.Effect<ReadonlyArray<RankedLink>, D1Database.DatabaseError, Security.CurrentUser>;
    /** The ids that exist and pass `filters`. */
    readonly filterIds: (
      ids: ReadonlyArray<string>,
      filters: SearchFilters,
    ) => Effect.Effect<ReadonlyArray<Link.LinkId>, D1Database.DatabaseError, Security.CurrentUser>;
    /** The links with these ids, keyed by id. Unknown ids are left out. */
    readonly loadLinks: (
      ids: ReadonlyArray<Link.LinkId>,
    ) => Effect.Effect<
      ReadonlyMap<Link.LinkId, Link.Link>,
      D1Database.DatabaseError,
      Security.CurrentUser
    >;
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
  if (filters.deviceId !== undefined) {
    conditions.push("l.source_device_id = ?");
    params.push(filters.deviceId);
  }
  if (filters.since !== undefined) {
    // `created_at` is UTC ISO 8601 with milliseconds, so text order is time order.
    conditions.push("l.created_at >= ?");
    params.push(DateTime.formatIso(filters.since));
  }
  return { sql: conditions.map((condition) => ` AND ${condition}`).join(""), params };
};

const placeholders = (count: number) => Array.from({ length: count }, () => "?").join(", ");

const KeywordRow = Schema.Struct({ linkId: Link.LinkId, rank: Schema.Number });
const IdRow = Schema.Struct({ id: Link.LinkId });

const decodePost = Schema.decodeUnknownOption(Schema.fromJsonString(Link.LinkPost));
const encodePost = Schema.encodeSync(Link.LinkPost);
/**
 * `links.post`: the JSON of a `Link.LinkPost`, or NULL. JSON this version cannot read (a shape
 * from another version) is no post, never a failed query.
 */
const PostColumn = Schema.NullOr(Schema.String).pipe(
  Schema.decodeTo(
    Schema.NullOr(Schema.toType(Link.LinkPost)),
    SchemaTransformation.transform({
      decode: (json) => (json === null ? null : Option.getOrNull(decodePost(json))),
      encode: (post) => (post === null ? null : JSON.stringify(encodePost(post))),
    }),
  ),
);

/** A `links` row with its tags as a JSON array, decoded into a `Link`. */
const LinkRow = Schema.Struct({
  ...Link.Link.fields,
  tags: Schema.fromJsonString(Schema.Array(Tag.TagName)),
  post: PostColumn,
});

const linkColumns = `l.id, l.url, l.canonical_url AS canonicalUrl, l.title, l.status, l.type,
  l.summary, l.language, l.image_url AS imageUrl, l.author, l.post, l.source_device_id AS sourceDeviceId, l.created_at AS createdAt,
  l.enriched_at AS enrichedAt, COALESCE(l.updated_at, l.created_at) AS updatedAt,
  (SELECT json_group_array(name) FROM (SELECT t.name FROM link_tags AS lt
    JOIN tags AS t ON t.id = lt.tag_id WHERE lt.link_id = l.id ORDER BY t.name)) AS tags`;

export const make = Effect.gen(function* () {
  const db = yield* D1Database.Database;
  const provide = Effect.provideService(D1Database.Database, db);
  return SearchRepo.of({
    keyword: Effect.fnUntraced(function* (match, filters, limit) {
      const user = yield* Security.CurrentUser;
      const filter = filterSql(filters);
      // The index row carries its user, so other users' matches are dropped before the join;
      // the join then checks the link itself.
      return yield* D1Database.query(KeywordRow)(
        D1Database.statement(
          `SELECT l.id AS linkId, ${bm25} AS rank FROM links_fts
            JOIN links AS l ON l.seq = links_fts.rowid
            WHERE links_fts MATCH ? AND links_fts.user_id = ? AND l.user_id = ?${filter.sql}
            ORDER BY rank, l.id LIMIT ?`,
          match,
          user.id,
          user.id,
          ...filter.params,
          limit,
        ),
      ).pipe(
        // bm25 is lower for better matches; negate it so higher ranks first.
        Effect.map((rows) => rows.map(({ linkId, rank }) => ({ linkId, score: -rank }))),
        provide,
      );
    }),
    filterIds: Effect.fnUntraced(function* (ids, filters) {
      const user = yield* Security.CurrentUser;
      if (ids.length === 0) return [];
      const filter = filterSql(filters);
      return yield* D1Database.query(IdRow)(
        D1Database.statement(
          `SELECT l.id FROM links AS l
            WHERE l.user_id = ? AND l.id IN (${placeholders(ids.length)})${filter.sql}`,
          user.id,
          ...ids,
          ...filter.params,
        ),
      ).pipe(
        Effect.map((rows) => rows.map(({ id }) => id)),
        provide,
      );
    }),
    loadLinks: Effect.fnUntraced(function* (ids) {
      const user = yield* Security.CurrentUser;
      if (ids.length === 0) return new Map<Link.LinkId, Link.Link>();
      return yield* D1Database.query(LinkRow)(
        D1Database.statement(
          `SELECT ${linkColumns} FROM links AS l
            WHERE l.user_id = ? AND l.id IN (${placeholders(ids.length)})`,
          user.id,
          ...ids,
        ),
      ).pipe(
        // A link that is no post has no `post` key.
        Effect.map(
          (rows) =>
            new Map<Link.LinkId, Link.Link>(
              rows.map(({ post, ...link }) => [link.id, post === null ? link : { ...link, post }]),
            ),
        ),
        provide,
      );
    }),
  });
});

/** The repo over the D1 `Database`. */
export const layer: Layer.Layer<SearchRepo, never, D1Database.Database> =
  Layer.effect(SearchRepo)(make);
