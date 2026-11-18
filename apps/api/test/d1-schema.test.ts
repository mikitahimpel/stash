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

  // D1 builds SQLite with SQLITE_MAX_LIKE_PATTERN_LENGTH = 50 and fails the whole migration batch
  // with "LIKE or GLOB pattern too complex" (#152). node:sqlite allows 50 000, so check the text.
  it("keeps every LIKE and GLOB pattern within D1's 50 bytes", () => {
    const encoder = new TextEncoder();
    for (const file of migrationFiles) {
      const sql = Fs.readFileSync(`${migrationsDir}${file}`, "utf8").replaceAll(/--.*$/gm, "");
      const operators = sql.match(/\b(?:LIKE|GLOB)\b/gi) ?? [];
      const patterns = [...sql.matchAll(/\b(?:LIKE|GLOB)\s+'((?:[^']|'')*)'/gi)].map((match) =>
        String(match[1]).replaceAll("''", "'"),
      );
      // Every pattern is a literal, so its length is known here.
      expect(patterns.length, file).toBe(operators.length);
      for (const pattern of patterns) {
        expect(encoder.encode(pattern).length, `${file}: ${pattern}`).toBeLessThanOrEqual(50);
      }
    }
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
        "device_pairings",
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

  it("keeps device tokens across the user-token rebuild of api_tokens", () => {
    const before = new DatabaseSync(":memory:", { enableForeignKeyConstraints: true });
    for (const file of migrationFiles.filter((name) => prefix(name) < 3)) {
      before.exec(Fs.readFileSync(`${migrationsDir}${file}`, "utf8"));
    }
    before.exec(`
      INSERT INTO devices (id, name, kind) VALUES ('d1', 'Test laptop', 'zen');
      INSERT INTO api_tokens (id, device_id, hash, created_at, revoked_at)
        VALUES ('t1', 'd1', 'hash-1', '2026-01-01T00:00:00.000Z', NULL);
      INSERT INTO open_tabs (device_id, url, last_seen_at)
        VALUES ('d1', 'https://example.com/tab', '2026-01-01T00:00:00.000Z');
    `);
    for (const file of migrationFiles.filter((name) => prefix(name) >= 3)) {
      before.exec(Fs.readFileSync(`${migrationsDir}${file}`, "utf8"));
    }
    expect(before.prepare("SELECT * FROM api_tokens").all()).toEqual([
      {
        id: "t1",
        device_id: "d1",
        name: null,
        github_login: null,
        hash: "hash-1",
        created_at: "2026-01-01T00:00:00.000Z",
        revoked_at: null,
        last_used_at: null,
      },
    ]);
    expect(before.prepare("SELECT count(*) AS n FROM open_tabs").get()).toEqual({ n: 1 });
    expect(before.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("keeps pending pairings across the claimed_at rebuild of device_pairings", () => {
    const before = new DatabaseSync(":memory:", { enableForeignKeyConstraints: true });
    for (const file of migrationFiles.filter((name) => prefix(name) < 5)) {
      before.exec(Fs.readFileSync(`${migrationsDir}${file}`, "utf8"));
    }
    before.exec(`
      INSERT INTO devices (id, name, kind) VALUES ('d1', 'Test laptop', 'zen');
      INSERT INTO device_pairings (code_hash, device_id, expires_at)
        VALUES ('hash-1', 'd1', '2026-01-01T00:10:00.000Z');
    `);
    for (const file of migrationFiles.filter((name) => prefix(name) >= 5)) {
      before.exec(Fs.readFileSync(`${migrationsDir}${file}`, "utf8"));
    }
    expect(before.prepare("SELECT * FROM device_pairings").all()).toEqual([
      {
        code_hash: "hash-1",
        device_id: "d1",
        expires_at: "2026-01-01T00:10:00.000Z",
        claimed_at: null,
      },
    ]);
    expect(before.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("keeps a pairing's code when its device is deleted", () => {
    db.exec(`
      INSERT INTO devices (id, name, kind) VALUES ('d1', 'Test laptop', 'zen');
      INSERT INTO device_pairings (code_hash, device_id, expires_at, claimed_at)
        VALUES ('hash-1', 'd1', '2026-01-01T00:10:00.000Z', '2026-01-01T00:01:00.000Z');
      DELETE FROM devices WHERE id = 'd1';
    `);
    expect(db.prepare("SELECT code_hash, device_id FROM device_pairings").all()).toEqual([
      { code_hash: "hash-1", device_id: null },
    ]);
  });

  it("stores a user token without a device, and only with a name and login", () => {
    db.exec(`INSERT INTO api_tokens (id, name, github_login, hash)
      VALUES ('t1', 'Claude (MCP)', 'synthetic-user', 'hash-1')`);
    expect(() => db.exec("INSERT INTO api_tokens (id, hash) VALUES ('t2', 'hash-2')")).toThrow(
      /CHECK/,
    );
    expect(() =>
      db.exec("INSERT INTO api_tokens (id, name, hash) VALUES ('t3', 'Claude (MCP)', 'hash-3')"),
    ).toThrow(/CHECK/);
  });

  it("records when a device's tabs snapshot was taken", () => {
    db.exec("INSERT INTO devices (id, name, kind) VALUES ('d1', 'Test laptop', 'zen')");
    expect(db.prepare("SELECT tabs_taken_at FROM devices WHERE id = 'd1'").get()).toEqual({
      tabs_taken_at: null,
    });
  });

  it("stores who published a link, and nothing by default", () => {
    db.exec(`INSERT INTO links (id, url, canonical_url) VALUES
      ('l1', 'https://example.com/a', 'https://example.com/a')`);
    const author = () => db.prepare("SELECT author FROM links WHERE id = 'l1'").get()?.["author"];
    expect(author()).toBeNull();
    db.exec("UPDATE links SET author = 'Synthetic Channel' WHERE id = 'l1'");
    expect(author()).toBe("Synthetic Channel");
  });

  it("starts every link at metadata version 0, so the backfill reads the old ones (#155)", () => {
    db.exec(`INSERT INTO links (id, url, canonical_url) VALUES
      ('l1', 'https://example.com/a', 'https://example.com/a')`);
    expect(db.prepare("SELECT metadata_version AS v FROM links WHERE id = 'l1'").get()).toEqual({
      v: 0,
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

describe("migration 0006: preview images and the repair of junk enrichments (#147)", () => {
  const enriched = "2026-01-01T00:01:00.000Z";
  const junkSummary =
    "The page text and title were unavailable, so the topic of this YouTube video cannot be determined.";

  // Links as they were stored before the fix, on the schema before the migration.
  const seeded = (): DatabaseSync => {
    const before = new DatabaseSync(":memory:", { enableForeignKeyConstraints: true });
    for (const file of migrationFiles.filter((name) => prefix(name) < 6)) {
      before.exec(Fs.readFileSync(`${migrationsDir}${file}`, "utf8"));
    }
    const insert = before.prepare(
      `INSERT INTO links (id, url, canonical_url, title, summary, enriched_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const video = (id: string) => `https://youtube.com/watch?v=${id}`;
    insert.run(
      "junk-title",
      "https://youtu.be/aaaaaaaaaaa",
      video("aaaaaaaaaaa"),
      "- YouTube",
      junkSummary,
      enriched,
    );
    insert.run(
      "no-title",
      "https://youtu.be/bbbbbbbbbbb",
      video("bbbbbbbbbbb"),
      null,
      "Something.",
      enriched,
    );
    insert.run(
      "junk-summary",
      "https://example.com/a",
      "https://example.com/a",
      "A page",
      "The topic could not be determined.",
      enriched,
    );
    insert.run(
      "junk-tag",
      "https://example.com/b",
      "https://example.com/b",
      "B page",
      "A fine summary.",
      enriched,
    );
    insert.run(
      "good-video",
      "https://youtu.be/ccccccccc_-",
      video("ccccccccc_-"),
      "A Synthetic Video",
      "A talk about parsers.",
      enriched,
    );
    insert.run(
      "good-page",
      "https://example.com/c",
      "https://example.com/c",
      "C page",
      "A fine summary.",
      enriched,
    );
    insert.run("not-enriched", "https://example.com/d", "https://example.com/d", null, null, null);
    insert.run(
      "playlist",
      "https://youtube.com/playlist?list=PLaaaaaaaaaaaaaaaa",
      "https://youtube.com/playlist?list=PLaaaaaaaaaaaaaaaa",
      "A list",
      "A fine summary.",
      enriched,
    );
    before.exec(`
      INSERT INTO tags (name) VALUES ('unclassified'), ('missing title'), ('economics');
      INSERT INTO link_tags (link_id, tag_id)
        SELECT 'junk-tag', id FROM tags;
      INSERT INTO link_tags (link_id, tag_id)
        SELECT 'good-page', id FROM tags WHERE name = 'economics';
    `);
    return before;
  };

  const migration = Fs.readFileSync(
    `${migrationsDir}${migrationFiles.find((name) => prefix(name) === 6)}`,
    "utf8",
  );

  const rows = (database: DatabaseSync) =>
    Object.fromEntries(
      database
        .prepare("SELECT id, title, summary, image_url, enriched_at FROM links")
        .all()
        .map((row) => [String(row["id"]), row]),
    );

  it("gives every stored YouTube video its thumbnail", () => {
    const database = seeded();
    database.exec(migration);
    const after = rows(database);
    expect(after["junk-title"]?.["image_url"]).toBe(
      "https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg",
    );
    expect(after["good-video"]?.["image_url"]).toBe(
      "https://i.ytimg.com/vi/ccccccccc_-/hqdefault.jpg",
    );
    for (const id of ["junk-summary", "good-page", "playlist", "not-enriched"]) {
      expect(after[id]?.["image_url"]).toBeNull();
    }
  });

  it("puts links with the symptoms back into the not-enriched state, and only those", () => {
    const database = seeded();
    database.exec(migration);
    const after = rows(database);
    for (const id of ["junk-title", "no-title", "junk-summary", "junk-tag"]) {
      expect(after[id]).toMatchObject({ summary: null, enriched_at: null });
    }
    expect(after["junk-title"]?.["title"]).toBeNull();
    expect(after["junk-summary"]?.["title"]).toBe("A page");
    for (const id of ["good-video", "good-page", "playlist"]) {
      expect(after[id]).toMatchObject({ enriched_at: enriched });
      expect(after[id]?.["summary"]).not.toBeNull();
    }
    // The placeholder tags are gone, real ones stay.
    expect(database.prepare("SELECT name FROM tags ORDER BY name").all()).toEqual([
      { name: "economics" },
    ]);
    expect(database.prepare("SELECT link_id FROM link_tags ORDER BY link_id").all()).toEqual([
      { link_id: "good-page" },
      { link_id: "junk-tag" },
    ]);
    // The keyword index follows: the junk summary is no longer found.
    expect(search(database, "unavailable")).toEqual([]);
    database.exec("INSERT INTO links_fts (links_fts) VALUES ('integrity-check')");
  });

  it("is idempotent: its repair statements match nothing the second time", () => {
    const database = seeded();
    database.exec(migration);
    const first = rows(database);
    // Everything after the ALTER TABLE, which D1 never runs twice.
    database.exec(migration.slice(migration.indexOf("UPDATE links")));
    expect(rows(database)).toEqual(first);
  });
});
