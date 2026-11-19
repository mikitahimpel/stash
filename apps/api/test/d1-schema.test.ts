// Applies every migration in `apps/api/migrations` to a fresh in-memory SQLite (node:sqlite, built
// with FTS5 like D1) in the order Alchemy applies them, then checks the schema and keyword search.
// The local-dev smoke test covers the same files applied by Alchemy to its D1 simulator.
import * as Fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import * as Path from "node:path";
import * as TestingSchema from "@stash/backend-platform/testing-schema";
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
        "users",
        "user_identities",
        "invites",
        "ai_usage",
      ]),
    );
  });

  it("passes SQLite's integrity and foreign key checks", () => {
    expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    db.exec("INSERT INTO links_fts (links_fts) VALUES ('integrity-check')");
  });

  it("enforces one link per canonical URL, per user", () => {
    db.exec(
      "INSERT INTO users (id, display_name, role) VALUES ('u2', 'Synthetic member', 'member')",
    );
    const insert = db.prepare(
      "INSERT INTO links (id, user_id, url, canonical_url) VALUES (?, ?, ?, ?)",
    );
    insert.run("l1", "owner", "https://example.com/a?utm=x", "https://example.com/a");
    insert.run("l2", "owner", "https://example.com/b", null);
    insert.run("l3", "owner", "https://example.com/c", null);
    expect(() =>
      insert.run("l4", "owner", "https://example.com/a", "https://example.com/a"),
    ).toThrow(/UNIQUE/);
    // Another user may save the same page.
    insert.run("l5", "u2", "https://example.com/a", "https://example.com/a");
    expect(() => insert.run("l6", "u2", "https://example.com/a", "https://example.com/a")).toThrow(
      /UNIQUE/,
    );
  });

  it("rejects unknown statuses and device kinds", () => {
    expect(() =>
      db
        .prepare(
          "INSERT INTO links (id, user_id, url, status) VALUES ('l1', 'owner', 'https://example.com', 'x')",
        )
        .run(),
    ).toThrow(/CHECK/);
    expect(() =>
      db
        .prepare(
          "INSERT INTO devices (id, user_id, name, kind) VALUES ('d1', 'owner', 'Laptop', 'fax')",
        )
        .run(),
    ).toThrow(/CHECK/);
  });

  it("cascades device deletes to tokens, tabs and commands and detaches links", () => {
    db.exec(`
      INSERT INTO devices (id, user_id, name, kind) VALUES ('d1', 'owner', 'Test laptop', 'zen');
      INSERT INTO api_tokens (id, user_id, device_id, hash) VALUES ('t1', 'owner', 'd1', 'hash-1');
      INSERT INTO open_tabs (user_id, device_id, url, last_seen_at)
        VALUES ('owner', 'd1', 'https://example.com/tab', '2026-01-01T00:00:00.000Z');
      INSERT INTO commands (id, user_id, device_id, kind, payload)
        VALUES ('c1', 'owner', 'd1', 'close-tab',
          '{"kind":"close-tab","url":"https://example.com/tab"}');
      INSERT INTO links (id, user_id, url, source_device_id)
        VALUES ('l1', 'owner', 'https://example.com/a', 'd1');
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
        user_id: "owner",
        device_id: "d1",
        name: null,
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
        user_id: "owner",
      },
    ]);
    expect(before.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("keeps a pairing's code when its device is deleted", () => {
    db.exec(`
      INSERT INTO devices (id, user_id, name, kind) VALUES ('d1', 'owner', 'Test laptop', 'zen');
      INSERT INTO device_pairings (code_hash, user_id, device_id, expires_at, claimed_at)
        VALUES ('hash-1', 'owner', 'd1', '2026-01-01T00:10:00.000Z', '2026-01-01T00:01:00.000Z');
      DELETE FROM devices WHERE id = 'd1';
    `);
    expect(db.prepare("SELECT code_hash, device_id FROM device_pairings").all()).toEqual([
      { code_hash: "hash-1", device_id: null },
    ]);
  });

  it("stores a user token without a device, and only with a name and a user", () => {
    db.exec(`INSERT INTO api_tokens (id, user_id, name, hash)
      VALUES ('t1', 'owner', 'Claude (MCP)', 'hash-1')`);
    // Neither a device nor a name.
    expect(() =>
      db.exec("INSERT INTO api_tokens (id, user_id, hash) VALUES ('t2', 'owner', 'hash-2')"),
    ).toThrow(/CHECK/);
    // Nobody's token.
    expect(() =>
      db.exec("INSERT INTO api_tokens (id, name, hash) VALUES ('t3', 'Claude (MCP)', 'hash-3')"),
    ).toThrow(/NOT NULL/);
    expect(() =>
      db.exec(`INSERT INTO api_tokens (id, user_id, name, hash)
        VALUES ('t4', 'nobody', 'Claude (MCP)', 'hash-4')`),
    ).toThrow(/FOREIGN KEY/);
  });

  it("records when a device's tabs snapshot was taken", () => {
    db.exec(
      "INSERT INTO devices (id, user_id, name, kind) VALUES ('d1', 'owner', 'Test laptop', 'zen')",
    );
    expect(db.prepare("SELECT tabs_taken_at FROM devices WHERE id = 'd1'").get()).toEqual({
      tabs_taken_at: null,
    });
  });

  it("stores who published a link, and nothing by default", () => {
    db.exec(`INSERT INTO links (id, user_id, url, canonical_url) VALUES
      ('l1', 'owner', 'https://example.com/a', 'https://example.com/a')`);
    const author = () => db.prepare("SELECT author FROM links WHERE id = 'l1'").get()?.["author"];
    expect(author()).toBeNull();
    db.exec("UPDATE links SET author = 'Synthetic Channel' WHERE id = 'l1'");
    expect(author()).toBe("Synthetic Channel");
  });

  it("starts every link at metadata version 0, so the backfill reads the old ones (#155)", () => {
    db.exec(`INSERT INTO links (id, user_id, url, canonical_url) VALUES
      ('l1', 'owner', 'https://example.com/a', 'https://example.com/a')`);
    expect(db.prepare("SELECT metadata_version AS v FROM links WHERE id = 'l1'").get()).toEqual({
      v: 0,
    });
  });

  it("stamps a link when it is saved and with every change a client can see (#169)", () => {
    const stamp = () =>
      String(db.prepare("SELECT updated_at FROM links WHERE id = 'link-1'").get()?.["updated_at"]);
    const past = "2026-01-02T03:04:05.000Z";
    const rewind = () => db.exec(`UPDATE links SET updated_at = '${past}' WHERE id = 'link-1'`);
    db.exec(
      "INSERT INTO links (id, user_id, url) VALUES ('link-1', 'owner', 'https://example.com/a')",
    );
    expect(stamp()).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);

    for (const change of [
      "UPDATE links SET status = 'seen' WHERE id = 'link-1'",
      "UPDATE links SET summary = 'A summary.', enriched_at = '2026-01-02T03:05:00.000Z' WHERE id = 'link-1'",
      "UPDATE links SET image_url = 'https://example.com/a.png' WHERE id = 'link-1'",
      "INSERT INTO tags (name) VALUES ('economics'); INSERT INTO link_tags (link_id, tag_id, user_id) SELECT 'link-1', id, 'owner' FROM tags",
      "DELETE FROM link_tags WHERE link_id = 'link-1'",
    ]) {
      rewind();
      db.exec(change);
      expect(stamp(), change).not.toBe(past);
    }

    // Bookkeeping a client never sees leaves the stamp alone.
    for (const change of [
      "UPDATE links SET enrichment_attempts = enrichment_attempts + 1 WHERE id = 'link-1'",
      "UPDATE links SET enrichment_error = 'classify: x', metadata_version = 1 WHERE id = 'link-1'",
    ]) {
      rewind();
      db.exec(change);
      expect(stamp(), change).toBe(past);
    }
  });

  it("removes a link's tags when the link is deleted", () => {
    db.exec(`
      INSERT INTO links (id, user_id, url) VALUES ('l1', 'owner', 'https://example.com/a');
      INSERT INTO tags (name) VALUES ('economics');
      INSERT INTO link_tags (link_id, tag_id, user_id)
        SELECT 'l1', id, 'owner' FROM tags WHERE name = 'economics';
      DELETE FROM links WHERE id = 'l1';
    `);
    expect(db.prepare("SELECT count(*) AS n FROM link_tags").get()).toEqual({ n: 0 });
  });
});

describe("links_fts", () => {
  const insertLink = (id: string, title: string, summary: string | null, text: string | null) =>
    db
      .prepare(
        "INSERT INTO links (id, user_id, url, title, summary, text) VALUES (?, 'owner', ?, ?, ?, ?)",
      )
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

describe("migration 0009: posts on X (#170)", () => {
  const enriched = "2026-01-01T00:01:00.000Z";
  const migration = Fs.readFileSync(`${migrationsDir}0009-link-post.sql`, "utf8");
  const post = "/example_writer/status/1700000000000000001";

  // Links as they were stored before the migration.
  const seeded = (): DatabaseSync => {
    const before = new DatabaseSync(":memory:", { enableForeignKeyConstraints: true });
    for (const file of migrationFiles.filter((name) => prefix(name) < 9)) {
      before.exec(Fs.readFileSync(`${migrationsDir}${file}`, "utf8"));
    }
    const insert = before.prepare(
      `INSERT INTO links (id, url, canonical_url, title, summary, enriched_at, enrichment_error,
         enrichment_attempts) VALUES (?, ?, ?, 'A title', 'A summary.', ?, ?, ?)`,
    );
    const hosts = {
      x: "x.com",
      twitter: "twitter.com",
      "mobile-x": "mobile.x.com",
      "mobile-twitter": "mobile.twitter.com",
      "m-twitter": "m.twitter.com",
      fx: "fxtwitter.com",
      vx: "vxtwitter.com",
      fixupx: "fixupx.com",
      fixvx: "fixvx.com",
    };
    for (const [id, host] of Object.entries(hosts)) {
      insert.run(
        id,
        `https://${host}${post}?s=20`,
        `https://${host}${post}?s=20`,
        enriched,
        null,
        0,
      );
    }
    insert.run("failed", "https://x.com/a/status/2", "https://x.com/a/status/2", null, "fetch", 5);
    insert.run(
      "profile",
      "https://x.com/example_writer",
      "https://x.com/example_writer",
      enriched,
      null,
      0,
    );
    insert.run(
      "page",
      "https://example.com/a/status/1",
      "https://example.com/a/status/1",
      enriched,
      null,
      0,
    );
    return before;
  };

  const rows = (database: DatabaseSync) =>
    Object.fromEntries(
      database
        .prepare(
          `SELECT id, title, summary, post, enriched_at, enrichment_error, enrichment_attempts
           FROM links`,
        )
        .all()
        .map((row) => [String(row["id"]), row]),
    );

  it("stores a post as JSON, and nothing by default", () => {
    db.exec(`INSERT INTO links (id, user_id, url, canonical_url) VALUES
      ('l1', 'owner', 'https://example.com/a', 'https://example.com/a')`);
    const stored = () => db.prepare("SELECT post FROM links WHERE id = 'l1'").get()?.["post"];
    expect(stored()).toBeNull();
    db.exec(`UPDATE links SET post = '{"state":"unavailable"}' WHERE id = 'l1'`);
    expect(stored()).toBe('{"state":"unavailable"}');
  });

  it("puts every stored link to a post back into the not-enriched state, and only those", () => {
    const database = seeded();
    database.exec(migration);
    const after = rows(database);
    for (const id of [
      "x",
      "twitter",
      "mobile-x",
      "mobile-twitter",
      "m-twitter",
      "fx",
      "vx",
      "fixupx",
      "fixvx",
    ]) {
      // The title and the summary stay until the post is read.
      expect(after[id], id).toMatchObject({
        title: "A title",
        summary: "A summary.",
        post: null,
        enriched_at: null,
      });
    }
    // A link that had failed for good gets its attempts back.
    expect(after["failed"]).toMatchObject({ enrichment_error: null, enrichment_attempts: 0 });
    for (const id of ["profile", "page"])
      expect(after[id]).toMatchObject({ enriched_at: enriched });
  });
});

describe("migrations 0011 to 0022: users, and every row to the owner (#177)", () => {
  const sqlOf = (file: string) => Fs.readFileSync(`${migrationsDir}${file}`, "utf8");
  const multiUser = migrationFiles.filter((name) => prefix(name) >= 11);
  const userTables = [
    "devices",
    "links",
    "link_tags",
    "open_tabs",
    "commands",
    "sessions",
    "device_pairings",
    "api_tokens",
    "digests",
  ];

  // A database as prod has it before this change: every table with rows, no users.
  const seeded = (): DatabaseSync => {
    const before = new DatabaseSync(":memory:", { enableForeignKeyConstraints: true });
    for (const file of migrationFiles.filter((name) => prefix(name) < 11)) before.exec(sqlOf(file));
    before.exec(`
      INSERT INTO devices (id, name, kind) VALUES ('d1', 'Synthetic Zen', 'zen');
      INSERT INTO links (id, url, canonical_url, title, summary, text, source_device_id, enriched_at)
        VALUES
        ('l1', 'https://example.com/a', 'https://example.com/a', 'Economics video',
          'About interest rates.', 'A long text about inflation.', 'd1', '2026-01-01T00:01:00.000Z'),
        ('l2', 'https://example.com/b', 'https://example.com/b', 'Gardening', NULL, NULL, NULL, NULL),
        ('l3', 'https://example.com/c', NULL, NULL, NULL, NULL, NULL, NULL);
      INSERT INTO tags (name) VALUES ('economics'), ('video');
      INSERT INTO link_tags (link_id, tag_id) SELECT 'l1', id FROM tags;
      INSERT INTO open_tabs (device_id, url, last_seen_at)
        VALUES ('d1', 'https://example.com/tab', '2026-01-01T00:00:00.000Z');
      INSERT INTO commands (id, device_id, kind, payload) VALUES ('c1', 'd1', 'close-tab', '{}');
      INSERT INTO api_tokens (id, device_id, hash, last_used_at)
        VALUES ('t1', 'd1', 'hash-1', '2026-01-01T00:00:00.000Z');
      INSERT INTO api_tokens (id, name, github_login, hash, revoked_at)
        VALUES ('t2', 'Claude (MCP)', 'synthetic-owner', 'hash-2', '2026-01-02T00:00:00.000Z');
      INSERT INTO sessions (id, github_login, expires_at, created_at) VALUES
        ('s0', 'synthetic-old-name', '2027-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
        ('s1', 'synthetic-owner', '2027-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z');
      INSERT INTO digests (period_start, period_end, content)
        VALUES ('2026-01-05', '2026-01-12', '{"n":1}');
      INSERT INTO device_pairings (code_hash, device_id, expires_at)
        VALUES ('code-1', 'd1', '2026-01-01T00:10:00.000Z');
    `);
    return before;
  };

  // Alchemy applies a file and its bookkeeping row as one transaction.
  const apply = (database: DatabaseSync, file: string) => {
    database.exec("BEGIN");
    try {
      database.exec(sqlOf(file));
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  };

  const migrated = (): DatabaseSync => {
    const database = seeded();
    for (const file of multiUser) apply(database, file);
    return database;
  };

  const all = (database: DatabaseSync, sql: string) => database.prepare(sql).all();
  const count = (database: DatabaseSync, table: string, where = "1") =>
    Number(database.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${where}`).get()?.["n"]);

  it("keeps every row and gives it to the owner", () => {
    const database = seeded();
    const counts = Object.fromEntries(userTables.map((table) => [table, count(database, table)]));
    const linksBefore = all(database, "SELECT * FROM links ORDER BY seq");
    const tokensBefore = all(
      database,
      "SELECT id, hash, device_id, name, revoked_at FROM api_tokens",
    );
    for (const file of multiUser) apply(database, file);

    expect(all(database, "SELECT id, display_name, role, daily_ai_quota FROM users")).toEqual([
      // Named after the login of the latest session.
      { id: "owner", display_name: "synthetic-owner", role: "owner", daily_ai_quota: null },
    ]);
    for (const table of userTables) {
      expect(count(database, table), table).toBe(counts[table]);
      expect(count(database, table, "user_id = 'owner'"), table).toBe(counts[table]);
    }
    // Every column a link had is as it was, `seq` and `updated_at` included.
    const linksAfter = all(database, "SELECT * FROM links ORDER BY seq");
    expect(linksAfter.map(({ user_id: _user, vector_version: _version, ...rest }) => rest)).toEqual(
      linksBefore,
    );
    // Tokens keep their hashes, so every device and the MCP connector stay signed in.
    expect(all(database, "SELECT id, hash, device_id, name, revoked_at FROM api_tokens")).toEqual(
      tokensBefore,
    );
    expect(all(database, "SELECT * FROM digests")).toMatchObject([
      {
        user_id: "owner",
        period_start: "2026-01-05",
        period_end: "2026-01-12",
        content: '{"n":1}',
      },
    ]);
    expect(database.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    expect(all(database, "PRAGMA foreign_key_check")).toEqual([]);
  });

  it("names the owner 'Owner' when nobody has signed in on the web yet", () => {
    const database = seeded();
    database.exec("DELETE FROM sessions");
    for (const file of multiUser) apply(database, file);
    expect(all(database, "SELECT id, display_name FROM users")).toEqual([
      { id: "owner", display_name: "Owner" },
    ]);
  });

  it("rebuilds the keyword index with each link's user, and it stays consistent", () => {
    const database = migrated();
    const matches = (query: string, user: string) =>
      all(
        database,
        `SELECT links.id AS id FROM links_fts JOIN links ON links.seq = links_fts.rowid
         WHERE links_fts MATCH '${query}' AND links_fts.user_id = '${user}'`,
      ).map((row) => row["id"]);
    // Rows stored before the migration are found, as the owner's.
    expect(matches("economics", "owner")).toEqual(["l1"]);
    expect(matches("inflation", "owner")).toEqual(["l1"]);
    expect(matches("gardening", "owner")).toEqual(["l2"]);

    database.exec(`
      INSERT INTO users (id, display_name, role, daily_ai_quota) VALUES ('u2', 'Member', 'member', 200);
      INSERT INTO links (id, user_id, url, canonical_url, title)
        VALUES ('m1', 'u2', 'https://example.com/a', 'https://example.com/a', 'Economics for members');
    `);
    expect(matches("economics", "owner")).toEqual(["l1"]);
    expect(matches("economics", "u2")).toEqual(["m1"]);
    database.exec("UPDATE links SET title = 'Renamed' WHERE id = 'm1'");
    expect(matches("economics", "u2")).toEqual([]);
    expect(matches("renamed", "u2")).toEqual(["m1"]);
    database.exec("DELETE FROM links WHERE id = 'm1'");
    expect(matches("renamed", "u2")).toEqual([]);
    // FTS5 compares the index with the content table and fails when they differ.
    database.exec("INSERT INTO links_fts (links_fts, rank) VALUES ('integrity-check', 1)");
  });

  it("refuses a row without a user from now on, in every table", () => {
    const database = migrated();
    const inserts: Record<string, string> = {
      devices: "INSERT INTO devices (id, name, kind) VALUES ('d9', 'Zen', 'zen')",
      links: "INSERT INTO links (id, url) VALUES ('l9', 'https://example.com/z')",
      link_tags: "INSERT INTO link_tags (link_id, tag_id) SELECT 'l2', id FROM tags LIMIT 1",
      open_tabs: `INSERT INTO open_tabs (device_id, url, last_seen_at)
        VALUES ('d1', 'https://example.com/z', '2026-01-01T00:00:00.000Z')`,
      commands:
        "INSERT INTO commands (id, device_id, kind, payload) VALUES ('c9', 'd1', 'close-tab', '{}')",
      sessions:
        "INSERT INTO sessions (id, github_login, expires_at) VALUES ('s9', 'x', '2027-01-01')",
      device_pairings:
        "INSERT INTO device_pairings (code_hash, device_id, expires_at) VALUES ('p9', 'd1', 'x')",
      api_tokens: "INSERT INTO api_tokens (id, device_id, hash) VALUES ('t9', 'd1', 'hash-9')",
      digests: "INSERT INTO digests (period_start, period_end, content) VALUES ('a', 'b', '{}')",
    };
    expect(Object.keys(inserts).sort()).toEqual([...userTables].sort());
    for (const [table, sql] of Object.entries(inserts)) {
      expect(() => database.exec(sql), table).toThrow(/user_id/);
    }
    // And a row cannot lose its user later.
    for (const table of ["devices", "links", "link_tags", "open_tabs", "commands", "sessions"]) {
      expect(() => database.exec(`UPDATE ${table} SET user_id = NULL`), table).toThrow(/user_id/);
    }
    // A user that does not exist owns nothing.
    expect(() =>
      database.exec(
        "INSERT INTO links (id, user_id, url) VALUES ('l9', 'nobody', 'https://example.com/z')",
      ),
    ).toThrow(/FOREIGN KEY/);
  });

  it("removes everything of a removed user and nothing of the owner", () => {
    const database = migrated();
    const ownerCounts = Object.fromEntries(
      userTables.map((table) => [table, count(database, table)]),
    );
    database.exec(`
      INSERT INTO users (id, display_name, role, daily_ai_quota) VALUES ('u2', 'Member', 'member', 200);
      INSERT INTO user_identities (provider, subject, user_id, label) VALUES ('github', '7001', 'u2', 'm');
      INSERT INTO ai_usage (user_id, day, links) VALUES ('u2', '2026-01-01', 3);
      INSERT INTO invites (id, token_hash, created_by, expires_at, accepted_at, accepted_by)
        VALUES ('i1', 'h', 'owner', '2027-01-01', '2026-01-01', 'u2');
      INSERT INTO devices (id, user_id, name, kind) VALUES ('d2', 'u2', 'Member Zen', 'zen');
      INSERT INTO links (id, user_id, url, canonical_url, source_device_id)
        VALUES ('m1', 'u2', 'https://example.com/a', 'https://example.com/a', 'd2');
      INSERT INTO link_tags (link_id, tag_id, user_id) SELECT 'm1', id, 'u2' FROM tags;
      INSERT INTO open_tabs (user_id, device_id, url, last_seen_at) VALUES ('u2', 'd2', 'https://example.com/t', 'x');
      INSERT INTO commands (id, user_id, device_id, kind, payload) VALUES ('c2', 'u2', 'd2', 'close-tab', '{}');
      INSERT INTO sessions (id, user_id, github_login, expires_at) VALUES ('s2', 'u2', 'm', '2027-01-01');
      INSERT INTO device_pairings (code_hash, user_id, device_id, expires_at) VALUES ('p2', 'u2', 'd2', 'x');
      INSERT INTO api_tokens (id, user_id, device_id, hash) VALUES ('t3', 'u2', 'd2', 'hash-3');
      -- The same week as the owner's digest: one each.
      INSERT INTO digests (user_id, period_start, period_end, content)
        VALUES ('u2', '2026-01-05', '2026-01-12', '{}');
      DELETE FROM users WHERE id = 'u2';
    `);
    for (const table of [...userTables, "user_identities", "ai_usage"]) {
      expect(count(database, table, "user_id = 'u2'"), table).toBe(0);
    }
    for (const table of userTables) expect(count(database, table), table).toBe(ownerCounts[table]);
    // The invite they used stays in the owner's list, without them.
    expect(all(database, "SELECT id, accepted_by FROM invites")).toEqual([
      { id: "i1", accepted_by: null },
    ]);
    expect(all(database, "PRAGMA foreign_key_check")).toEqual([]);
    database.exec("INSERT INTO links_fts (links_fts, rank) VALUES ('integrity-check', 1)");
    // There is one owner, always.
    expect(() =>
      database.exec("INSERT INTO users (id, display_name, role) VALUES ('o2', 'Second', 'owner')"),
    ).toThrow(/UNIQUE/);
  });

  it("a file that fails leaves nothing behind, and applying it again finishes the job", () => {
    const database = seeded();
    for (const file of multiUser) {
      // The deploy dies on the file's last statement: everything it did is rolled back.
      database.exec("BEGIN");
      database.exec(sqlOf(file));
      database.exec("ROLLBACK");
      apply(database, file);
    }
    const reference = migrated();
    const schemaOf = (d: DatabaseSync) =>
      all(d, "SELECT name, sql FROM sqlite_schema ORDER BY name");
    expect(schemaOf(database)).toEqual(schemaOf(reference));
    for (const table of [...userTables, "users"]) {
      expect(count(database, table), table).toBe(count(reference, table));
    }
  });

  it("repeating a file by hand loses no row", () => {
    // D1 never applies a file twice. If someone does, by hand: the statements that can repeat do
    // nothing, and the rest fail before changing anything.
    const database = migrated();
    database.exec("INSERT INTO users (id, display_name, role) VALUES ('u2', 'Member', 'member')");
    database.exec(
      "INSERT INTO links (id, user_id, url, title) VALUES ('m1', 'u2', 'https://example.com/m', 'Member link')",
    );
    const snapshot = () =>
      Object.fromEntries(
        [...userTables, "users"].map((table) => [
          table,
          all(database, `SELECT * FROM ${table} ORDER BY 1, 2`),
        ]),
      );
    const before = snapshot();
    for (const file of multiUser) {
      try {
        apply(database, file);
      } catch {
        // `ALTER TABLE ... ADD COLUMN` of a column that exists: nothing was changed.
      }
    }
    expect(snapshot()).toEqual(before);
    // A member's rows are not handed to the owner by a repeat.
    expect(all(database, "SELECT user_id FROM links WHERE id = 'm1'")).toEqual([{ user_id: "u2" }]);
    expect(database.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    database.exec("INSERT INTO links_fts (links_fts, rank) VALUES ('integrity-check', 1)");
  });

  it("stays within D1's limits: no LIKE or GLOB, small statements, no transaction control", () => {
    for (const file of multiUser) {
      const sql = sqlOf(file).replaceAll(/--.*$/gm, "");
      expect(sql, file).not.toMatch(/\b(?:LIKE|GLOB)\b/i);
      // D1 runs a migration in its own transaction and rejects these.
      expect(sql, file).not.toMatch(/\b(?:BEGIN TRANSACTION|COMMIT|ROLLBACK|PRAGMA)\b/i);
      // No statement binds a value, and each is far below D1's 100 KB.
      expect(sql, file).not.toContain("?");
      expect(new TextEncoder().encode(sql).length, file).toBeLessThan(20_000);
    }
  });

  it("starts every stored link at vector version 0, so the backfill reads them", () => {
    const database = migrated();
    expect(all(database, "SELECT DISTINCT vector_version AS v FROM links")).toEqual([{ v: 0 }]);
  });
});

describe("the schema copy for tests", () => {
  it("is what the migrations create", () => {
    const rows = migrate()
      .prepare(
        `SELECT sql FROM sqlite_schema
         WHERE sql IS NOT NULL AND NOT (type = 'table' AND name GLOB 'links_fts_*')
         ORDER BY rowid`,
      )
      .all();
    const text = `\n${rows.map((row) => `${String(row["sql"])};`).join("\n\n")}\n`;
    // On a mismatch, paste the left side into `packages/backend/platform/src/testing-schema.ts`.
    expect(text).toBe(TestingSchema.schema);
  });
});
