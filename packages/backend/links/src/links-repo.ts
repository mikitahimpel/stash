import * as D1Database from "@stash/backend-platform/d1-database";
import type * as Device from "@stash/contracts-domain/device";
import * as Link from "@stash/contracts-domain/link";
import * as Tag from "@stash/contracts-domain/tag";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

// The `links`, `tags` and `link_tags` tables. Lists of values travel as one JSON parameter read
// with `json_each`, so a statement never runs into D1's limit on bound parameters, and a batch of
// any size is a fixed number of statements.

/** A link to insert. */
export interface NewLink {
  readonly id: Link.LinkId;
  readonly url: Link.Url;
  readonly canonicalUrl: Link.Url;
  readonly title: string | null;
  readonly tags: ReadonlyArray<Tag.TagName>;
  readonly sourceDeviceId: Device.DeviceId | null;
  readonly createdAt: DateTime.Utc;
}

/** Where a page of the newest-first list starts: strictly after this link. */
export interface ListPosition {
  readonly createdAt: string;
  readonly seq: number;
}

/** Filters that combine with AND. `seen: false` means status `new`, `seen: true` any other. */
export interface ListFilter {
  readonly status?: Link.LinkStatus;
  readonly type?: Link.LinkType;
  readonly tag?: Tag.TagName;
  readonly seen?: boolean;
  readonly after?: ListPosition;
  readonly limit: number;
}

/** A listed link with its position, for the next cursor. */
export interface ListedLink {
  readonly link: Link.Link;
  readonly position: ListPosition;
}

/** The fields a patch may set. Tags replace the link's tags. */
export interface LinkChanges {
  readonly title?: string;
  readonly status?: Link.LinkStatus;
  readonly type?: Link.LinkType;
  readonly tags?: ReadonlyArray<Tag.TagName>;
}

/** The links tables. */
export class LinksRepo extends Context.Service<
  LinksRepo,
  {
    readonly findById: (
      id: Link.LinkId,
    ) => Effect.Effect<Option.Option<Link.Link>, D1Database.DatabaseError>;
    /** The stored links with these canonical URLs, in no particular order. */
    readonly findByCanonicalUrls: (
      urls: ReadonlyArray<Link.Url>,
    ) => Effect.Effect<ReadonlyArray<Link.Link>, D1Database.DatabaseError>;
    /**
     * Inserts the links in order, in one transaction, skipping any whose canonical URL is already
     * stored (including by an earlier link of the same call). Returns the stored link for each
     * input: the new one, or the one that was already there.
     */
    readonly insertAll: (
      links: ReadonlyArray<NewLink>,
    ) => Effect.Effect<ReadonlyArray<Link.Link>, D1Database.DatabaseError>;
    /** Newest first: by `createdAt`, then by insertion order. At most `limit` links. */
    readonly list: (
      filter: ListFilter,
    ) => Effect.Effect<ReadonlyArray<ListedLink>, D1Database.DatabaseError>;
    /** `None` if there is no such link. */
    readonly update: (
      id: Link.LinkId,
      changes: LinkChanges,
    ) => Effect.Effect<Option.Option<Link.Link>, D1Database.DatabaseError>;
    /** `false` if there is no such link. */
    readonly remove: (id: Link.LinkId) => Effect.Effect<boolean, D1Database.DatabaseError>;
  }
>()("@stash/backend-links/LinksRepo") {}

/** A link row as selected below: tags arrive as a JSON array. */
const LinkRow = Schema.Struct({
  ...Link.Link.fields,
  tags: Schema.fromJsonString(Schema.Array(Tag.TagName)),
});

const ListedRow = Schema.Struct({
  ...LinkRow.fields,
  seq: Schema.Int,
  createdAtText: Schema.String,
});

const linkColumns = `l.id, l.url, l.canonical_url AS canonicalUrl, l.title, l.status, l.type,
  l.summary, l.language,
  (SELECT json_group_array(name) FROM (
    SELECT t.name FROM link_tags lt JOIN tags t ON t.id = lt.tag_id
    WHERE lt.link_id = l.id ORDER BY t.name
  )) AS tags,
  l.source_device_id AS sourceDeviceId, l.created_at AS createdAt, l.enriched_at AS enrichedAt`;

/** `[{ id, tags }]` as JSON: the tag rows and link-tag rows for these links, if they exist. */
const tagStatements = (json: string): ReadonlyArray<D1Database.Statement> => [
  D1Database.statement(
    `INSERT OR IGNORE INTO tags (name)
      SELECT DISTINCT t.value FROM json_each(?) AS l, json_each(l.value, '$.tags') AS t
      WHERE EXISTS (SELECT 1 FROM links WHERE links.id = json_extract(l.value, '$.id'))`,
    json,
  ),
  D1Database.statement(
    `INSERT OR IGNORE INTO link_tags (link_id, tag_id)
      SELECT json_extract(l.value, '$.id'), tags.id
      FROM json_each(?) AS l, json_each(l.value, '$.tags') AS t JOIN tags ON tags.name = t.value
      WHERE EXISTS (SELECT 1 FROM links WHERE links.id = json_extract(l.value, '$.id'))`,
    json,
  ),
];

export const make = Effect.gen(function* () {
  const db = yield* D1Database.Database;
  const provide = Effect.provideService(D1Database.Database, db);
  const query = <S extends Schema.Constraint>(schema: S, s: D1Database.Statement) =>
    D1Database.query(schema)(s).pipe(provide);

  const findById = (id: Link.LinkId) =>
    D1Database.queryFirst(LinkRow)(
      D1Database.statement(`SELECT ${linkColumns} FROM links l WHERE l.id = ?`, id),
    ).pipe(provide);

  const findByCanonicalUrls = (urls: ReadonlyArray<Link.Url>) =>
    urls.length === 0
      ? Effect.succeed([])
      : query(
          LinkRow,
          D1Database.statement(
            `SELECT ${linkColumns} FROM links l
              WHERE l.canonical_url IN (SELECT value FROM json_each(?))`,
            JSON.stringify(urls),
          ),
        );

  return LinksRepo.of({
    findById,
    findByCanonicalUrls,
    insertAll: Effect.fn("LinksRepo.insertAll")(function* (links) {
      if (links.length === 0) return [];
      const rows = JSON.stringify(
        links.map((link) => ({
          id: link.id,
          url: link.url,
          canonicalUrl: link.canonicalUrl,
          title: link.title,
          tags: link.tags,
          sourceDeviceId: link.sourceDeviceId,
          createdAt: DateTime.formatIso(link.createdAt),
        })),
      );
      // `WHERE true` keeps SQLite from reading `ON CONFLICT` as a join constraint.
      yield* db.batch([
        D1Database.statement(
          `INSERT INTO links (id, url, canonical_url, title, source_device_id, created_at)
            SELECT json_extract(value, '$.id'), json_extract(value, '$.url'),
              json_extract(value, '$.canonicalUrl'), json_extract(value, '$.title'),
              json_extract(value, '$.sourceDeviceId'), json_extract(value, '$.createdAt')
            FROM json_each(?) WHERE true ORDER BY key
            ON CONFLICT (canonical_url) DO NOTHING`,
          rows,
        ),
        ...tagStatements(rows),
      ]);
      const stored = yield* findByCanonicalUrls(links.map((link) => link.canonicalUrl));
      const byCanonicalUrl = new Map(stored.map((link) => [link.canonicalUrl, link]));
      return yield* Effect.forEach(links, (link) => {
        const found = byCanonicalUrl.get(link.canonicalUrl);
        return found === undefined
          ? Effect.die(new Error(`link ${link.id} is missing after insert`))
          : Effect.succeed(found);
      });
    }),
    list: (filter) => {
      const conditions: Array<string> = [];
      const params: Array<D1Database.Value> = [];
      if (filter.status !== undefined) {
        conditions.push("l.status = ?");
        params.push(filter.status);
      }
      if (filter.type !== undefined) {
        conditions.push("l.type = ?");
        params.push(filter.type);
      }
      if (filter.seen !== undefined) {
        conditions.push(filter.seen ? "l.status <> 'new'" : "l.status = 'new'");
      }
      if (filter.tag !== undefined) {
        conditions.push(`EXISTS (SELECT 1 FROM link_tags lt JOIN tags t ON t.id = lt.tag_id
          WHERE lt.link_id = l.id AND t.name = ?)`);
        params.push(filter.tag);
      }
      if (filter.after !== undefined) {
        conditions.push("(l.created_at < ? OR (l.created_at = ? AND l.seq < ?))");
        params.push(filter.after.createdAt, filter.after.createdAt, filter.after.seq);
      }
      const where = conditions.length === 0 ? "" : `WHERE ${conditions.join(" AND ")}`;
      return query(
        ListedRow,
        D1Database.statement(
          `SELECT ${linkColumns}, l.seq, l.created_at AS createdAtText FROM links l ${where}
            ORDER BY l.created_at DESC, l.seq DESC LIMIT ?`,
          ...params,
          filter.limit,
        ),
      ).pipe(
        Effect.map((rows) =>
          rows.map(({ seq, createdAtText, ...link }) => ({
            link,
            position: { createdAt: createdAtText, seq },
          })),
        ),
      );
    },
    update: Effect.fn("LinksRepo.update")(function* (id, changes) {
      if (Option.isNone(yield* findById(id))) return Option.none();
      const sets: Array<string> = [];
      const params: Array<D1Database.Value> = [];
      for (const [column, value] of [
        ["title", changes.title],
        ["status", changes.status],
        ["type", changes.type],
      ] as const) {
        if (value !== undefined) {
          sets.push(`${column} = ?`);
          params.push(value);
        }
      }
      const statements: Array<D1Database.Statement> = [];
      if (sets.length > 0) {
        statements.push(
          D1Database.statement(`UPDATE links SET ${sets.join(", ")} WHERE id = ?`, ...params, id),
        );
      }
      if (changes.tags !== undefined) {
        statements.push(
          D1Database.sql`DELETE FROM link_tags WHERE link_id = ${id}`,
          ...tagStatements(JSON.stringify([{ id, tags: changes.tags }])),
        );
      }
      yield* db.batch(statements);
      return yield* findById(id);
    }),
    remove: (id) =>
      db
        .run(D1Database.sql`DELETE FROM links WHERE id = ${id}`)
        .pipe(Effect.map((result) => result.changes > 0)),
  });
});

/** The repo over the D1 `Database`. */
export const layer: Layer.Layer<LinksRepo, never, D1Database.Database> =
  Layer.effect(LinksRepo)(make);
