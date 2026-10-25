import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as D1Database from "../src/d1-database.ts";
import * as Testing from "../src/testing.ts";

const Note = Schema.Struct({ id: Schema.Number, url: Schema.String, pinned: Schema.Number });

const setup = Effect.gen(function* () {
  const db = yield* D1Database.Database;
  yield* db.exec(`
    CREATE TABLE notes (id INTEGER PRIMARY KEY, url TEXT NOT NULL UNIQUE, pinned INTEGER NOT NULL);
  `);
  return db;
});

describe("Database (node:sqlite test layer)", () => {
  it.effect("runs writes and queries with bound parameters", () =>
    Effect.gen(function* () {
      const db = yield* setup;
      const inserted = yield* db.run(
        D1Database.sql`INSERT INTO notes (url, pinned) VALUES (${"https://example.com/a"}, ${true})`,
      );
      expect(inserted).toEqual({ changes: 1, lastRowId: 1 });
      yield* db.run(
        D1Database.statement(
          "INSERT INTO notes (url, pinned) VALUES (?, ?)",
          "https://example.com/b",
          false,
        ),
      );

      const rows = yield* db.all(D1Database.sql`SELECT * FROM notes ORDER BY id`);
      expect(rows).toEqual([
        { id: 1, url: "https://example.com/a", pinned: 1 },
        { id: 2, url: "https://example.com/b", pinned: 0 },
      ]);
      expect(yield* db.first(D1Database.sql`SELECT url FROM notes WHERE id = ${2}`)).toEqual(
        Option.some({ url: "https://example.com/b" }),
      );
      expect(yield* db.first(D1Database.sql`SELECT url FROM notes WHERE id = ${99}`)).toEqual(
        Option.none(),
      );
    }).pipe(Effect.provide(Testing.layerD1Database)),
  );

  it.effect("decodes rows with a schema", () =>
    Effect.gen(function* () {
      const db = yield* setup;
      yield* db.run(
        D1Database.sql`INSERT INTO notes (url, pinned) VALUES (${"https://example.com/a"}, ${1})`,
      );
      const all = yield* D1Database.query(Note)(D1Database.sql`SELECT * FROM notes`);
      expect(all).toEqual([{ id: 1, url: "https://example.com/a", pinned: 1 }]);
      const first = yield* D1Database.queryFirst(Note)(D1Database.sql`SELECT * FROM notes`);
      expect(first).toEqual(Option.some({ id: 1, url: "https://example.com/a", pinned: 1 }));

      const wrong = yield* D1Database.query(Schema.Struct({ url: Schema.Number }))(
        D1Database.sql`SELECT url FROM notes`,
      ).pipe(Effect.flip);
      expect(wrong).toBeInstanceOf(D1Database.DatabaseError);
      expect(wrong.operation).toBe("decode");
    }).pipe(Effect.provide(Testing.layerD1Database)),
  );

  it.effect("maps SQL failures to DatabaseError without leaking parameters", () =>
    Effect.gen(function* () {
      const db = yield* setup;
      const error = yield* db
        .all(D1Database.sql`SELECT * FROM missing WHERE x = ${"secret-ish"}`)
        .pipe(Effect.flip);
      expect(error._tag).toBe("DatabaseError");
      expect(error.operation).toBe("all");
      expect(error.sql).toBe("SELECT * FROM missing WHERE x = ?");
    }).pipe(Effect.provide(Testing.layerD1Database)),
  );

  it.effect("batch is one transaction", () =>
    Effect.gen(function* () {
      const db = yield* setup;
      const insert = (url: string) =>
        D1Database.sql`INSERT INTO notes (url, pinned) VALUES (${url}, ${0})`;
      const ok = yield* db.batch([
        insert("https://example.com/a"),
        insert("https://example.com/b"),
      ]);
      expect(ok.map((r) => r.changes)).toEqual([1, 1]);

      const failed = yield* Effect.exit(
        db.batch([insert("https://example.com/c"), insert("https://example.com/a")]),
      );
      expect(Exit.isFailure(failed)).toBe(true);
      const count = yield* db.first(D1Database.sql`SELECT count(*) AS n FROM notes`);
      expect(count).toEqual(Option.some({ n: 2 }));
      expect(yield* db.batch([])).toEqual([]);
    }).pipe(Effect.provide(Testing.layerD1Database)),
  );

  it.effect("each build gets an empty database", () =>
    Effect.gen(function* () {
      const db = yield* D1Database.Database;
      const tables = yield* db.all(
        D1Database.sql`SELECT name FROM sqlite_master WHERE type = ${"table"}`,
      );
      expect(tables).toEqual([]);
    }).pipe(Effect.provide(Testing.layerD1Database)),
  );

  it.effect("supports FTS5, which search relies on", () =>
    Effect.gen(function* () {
      const db = yield* D1Database.Database;
      yield* db.exec("CREATE VIRTUAL TABLE docs USING fts5(title)");
      yield* db.run(D1Database.sql`INSERT INTO docs (title) VALUES (${"Economics explained"})`);
      const hits = yield* db.all(
        D1Database.sql`SELECT title FROM docs WHERE docs MATCH ${"economics"}`,
      );
      expect(hits).toEqual([{ title: "Economics explained" }]);
    }).pipe(Effect.provide(Testing.layerD1Database)),
  );
});
