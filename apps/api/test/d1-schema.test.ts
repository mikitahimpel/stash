// Applies every migration in `apps/api/migrations` to a fresh in-memory SQLite (node:sqlite, built
// with FTS5 like D1) in the order Alchemy applies them, then checks the schema and keyword search.
// The local-dev smoke test covers the same files applied by Alchemy to its D1 simulator.
import * as Fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import * as Path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

const migrationsDir = `${Path.resolve(import.meta.dirname, "../migrations")}/`;

// Alchemy orders by the numeric prefix, then by name.
const prefix = (name: string): number => Number(/^(\d+)/.exec(name)?.[1] ?? Number.NaN);
const migrationFiles = Fs.readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .sort((a, b) => prefix(a) - prefix(b) || a.localeCompare(b));

const migrate = (): DatabaseSync => {
  const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: true });
  for (const file of migrationFiles) db.exec(Fs.readFileSync(`${migrationsDir}${file}`, "utf8"));
  return db;
};

const search = (db: DatabaseSync, query: string): ReadonlyArray<string> =>
  db
    .prepare(
      `SELECT links.id AS id FROM links_fts
       JOIN links ON links.seq = links_fts.rowid
       WHERE links_fts MATCH ? ORDER BY rank`,
    )
    .all(query)
    .map((row) => String(row["id"]));

let db: DatabaseSync;

beforeEach(() => {
  db = migrate();
});

describe("D1 migrations", () => {
  it("has numbered migration files", () => {
    expect(migrationFiles.length).toBeGreaterThan(0);
    for (const file of migrationFiles) expect(file).toMatch(/^\d{4}-[a-z0-9-]+\.sql$/);
  });

  it("creates every table", () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => String(row["name"]));
    expect(tables).toEqual(
      expect.arrayContaining([
        "api_tokens",
        "commands",
        "devices",
        "digests",
        "link_tags",
        "links",
        "links_fts",
        "open_tabs",
        "sessions",
        "tags",
      ]),
    );
  });

  it("passes SQLite's integrity and foreign key checks", () => {
    expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    db.exec("INSERT INTO links_fts (links_fts) VALUES ('integrity-check')");
  });

  it("enforces one link per canonical URL", () => {
    const insert = db.prepare("INSERT INTO links (id, url, canonical_url) VALUES (?, ?, ?)");
    insert.run("l1", "https://example.com/a?utm=x", "https://example.com/a");
    insert.run("l2", "https://example.com/b", null);
    insert.run("l3", "https://example.com/c", null);
    expect(() => insert.run("l4", "https://example.com/a", "https://example.com/a")).toThrow(
      /UNIQUE/,
    );
  });

  it("rejects unknown statuses and device kinds", () => {
    expect(() =>
      db
        .prepare("INSERT INTO links (id, url, status) VALUES ('l1', 'https://example.com', 'x')")
        .run(),
    ).toThrow(/CHECK/);
    expect(() =>
      db.prepare("INSERT INTO devices (id, name, kind) VALUES ('d1', 'Laptop', 'fax')").run(),
    ).toThrow(/CHECK/);
  });

  it("cascades device deletes to tokens, tabs and commands and detaches links", () => {
    db.exec(`
      INSERT INTO devices (id, name, kind) VALUES ('d1', 'Test laptop', 'zen');
      INSERT INTO api_tokens (id, device_id, hash) VALUES ('t1', 'd1', 'hash-1');
      INSERT INTO open_tabs (device_id, url, last_seen_at)
        VALUES ('d1', 'https://example.com/tab', '2026-01-01T00:00:00.000Z');
      INSERT INTO commands (id, device_id, kind, payload)
        VALUES ('c1', 'd1', 'close-tab', '{"kind":"close-tab","url":"https://example.com/tab"}');
      INSERT INTO links (id, url, source_device_id) VALUES ('l1', 'https://example.com/a', 'd1');
      DELETE FROM devices WHERE id = 'd1';
    `);
    for (const table of ["api_tokens", "open_tabs", "commands"]) {
      expect(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()).toEqual({ n: 0 });
    }
    expect(db.prepare("SELECT source_device_id FROM links WHERE id = 'l1'").get()).toEqual({
      source_device_id: null,
    });
  });

  it("removes a link's tags when the link is deleted", () => {
    db.exec(`
      INSERT INTO links (id, url) VALUES ('l1', 'https://example.com/a');
      INSERT INTO tags (name) VALUES ('economics');
      INSERT INTO link_tags (link_id, tag_id) SELECT 'l1', id FROM tags WHERE name = 'economics';
      DELETE FROM links WHERE id = 'l1';
    `);
    expect(db.prepare("SELECT count(*) AS n FROM link_tags").get()).toEqual({ n: 0 });
  });
});

describe("links_fts", () => {
  const insertLink = (id: string, title: string, summary: string | null, text: string | null) =>
    db
      .prepare("INSERT INTO links (id, url, title, summary, text) VALUES (?, ?, ?, ?, ?)")
      .run(id, `https://example.com/${id}`, title, summary, text);

  it("finds an inserted link via MATCH on title, summary and text", () => {
    insertLink("l1", "A video about economics", null, null);
    insertLink("l2", "Gardening basics", "How to grow tomatoes", "Water them every morning");
    expect(search(db, "economics")).toEqual(["l1"]);
    expect(search(db, "tomatoes")).toEqual(["l2"]);
    expect(search(db, "text:morning")).toEqual(["l2"]);
    expect(search(db, "econom*")).toEqual(["l1"]);
  });

  it("matches Cyrillic text and ignores diacritics", () => {
    insertLink("l1", "Видео про экономику", null, null);
    insertLink("l2", "Café culture", null, null);
    expect(search(db, "экономику")).toEqual(["l1"]);
    expect(search(db, "cafe")).toEqual(["l2"]);
  });

  it("follows updates and deletes", () => {
    insertLink("l1", "Draft title", null, null);
    db.prepare("UPDATE links SET title = ?, summary = ? WHERE id = ?").run(
      "Final title",
      "About inflation",
      "l1",
    );
    expect(search(db, "draft")).toEqual([]);
    expect(search(db, "inflation")).toEqual(["l1"]);

    db.prepare("UPDATE links SET status = 'seen' WHERE id = 'l1'").run();
    expect(search(db, "final")).toEqual(["l1"]);

    db.prepare("DELETE FROM links WHERE id = 'l1'").run();
    expect(search(db, "final")).toEqual([]);
    db.exec("INSERT INTO links_fts (links_fts) VALUES ('integrity-check')");
  });
});
