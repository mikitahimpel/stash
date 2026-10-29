import type { WorkerEnv } from "./worker-env.ts";

// Synthetic data for the web screenshots (`pnpm --filter @stash/web screenshots`): devices, a month
// of links with tags and statuses, and open tabs of every age. Every id starts with `seed-`, and a
// new seed first removes the rows of the previous one, so seeding twice gives the same picture.
// Ages are relative to the request, so the charts always cover the last 30 days.

const day = 24 * 60 * 60 * 1000;

const devices = [
  { id: "seed-device-laptop", name: "Work laptop", kind: "zen" },
  { id: "seed-device-desktop", name: "Home desktop", kind: "zen" },
  { id: "seed-device-phone", name: "iPhone", kind: "ios" },
] as const;

type SeedLink = readonly [
  title: string,
  path: string,
  type: string,
  tags: ReadonlyArray<string>,
  status: "new" | "seen" | "done",
  ageDays: number,
  device: number,
];

const links: ReadonlyArray<SeedLink> = [
  [
    "How interest rates move housing prices",
    "economics/rates",
    "video",
    ["economics"],
    "new",
    0.1,
    2,
  ],
  [
    "A field guide to SQLite full-text search",
    "db/fts5",
    "article",
    ["sqlite", "search"],
    "new",
    0.3,
    0,
  ],
  ["Effect v4 release notes", "effect/v4", "article", ["effect", "typescript"], "new", 0.6, 0],
  ["Designing keyboard-first web apps", "ux/keyboard", "article", ["design", "ux"], "seen", 1.2, 1],
  [
    "Workers Static Assets in practice",
    "cloudflare/assets",
    "article",
    ["cloudflare"],
    "new",
    1.5,
    0,
  ],
  ["Vue 3 reactivity in depth", "vue/reactivity", "video", ["vue"], "done", 2.1, 1],
  [
    "Variable fonts on the web",
    "type/variable-fonts",
    "article",
    ["design", "type"],
    "seen",
    2.6,
    2,
  ],
  [
    "oxlint rules worth turning on",
    "tools/oxlint",
    "tool",
    ["typescript", "tooling"],
    "new",
    3.2,
    0,
  ],
  [
    "Why inflation feels different by city",
    "economics/inflation",
    "video",
    ["economics"],
    "done",
    3.9,
    2,
  ],
  ["Hairline dividers and visual rhythm", "design/rhythm", "article", ["design"], "seen", 4.4, 1],
  [
    "Queue retries with backoff",
    "patterns/retries",
    "article",
    ["cloudflare", "patterns"],
    "done",
    5.0,
    0,
  ],
  [
    "A tiny CLI for SQLite dumps",
    "repo/sqlite-dump",
    "repo",
    ["sqlite", "tooling"],
    "seen",
    5.8,
    0,
  ],
  [
    "Semantic search with small embeddings",
    "ml/embeddings",
    "article",
    ["search", "ml"],
    "new",
    6.5,
    1,
  ],
  ["The economics of open source", "economics/open-source", "video", ["economics"], "seen", 7.3, 2],
  ["Accessible segmented controls", "a11y/segmented", "article", ["ux", "a11y"], "done", 8.1, 1],
  ["Building a PWA for the home screen", "web/pwa", "article", ["web"], "seen", 9.0, 2],
  ["Tailwind v4 theme variables", "css/tailwind-v4", "article", ["css", "design"], "done", 10.2, 0],
  ["Reading Safari iCloud Tabs", "apple/cloud-tabs", "article", ["apple"], "seen", 11.4, 2],
  [
    "Typed HTTP APIs end to end",
    "effect/http-api",
    "video",
    ["effect", "typescript"],
    "done",
    12.7,
    0,
  ],
  ["Dark mode color tokens", "design/dark-tokens", "article", ["design", "css"], "seen", 13.5, 1],
  ["A minimal markdown editor", "repo/markdown-editor", "repo", ["tooling"], "done", 14.8, 0],
  [
    "Inline SVG charts without a library",
    "dataviz/inline-svg",
    "article",
    ["dataviz"],
    "seen",
    16.1,
    1,
  ],
  ["Cron triggers on the edge", "cloudflare/cron", "article", ["cloudflare"], "done", 17.6, 0],
  [
    "What a central bank actually does",
    "economics/central-banks",
    "video",
    ["economics"],
    "seen",
    19.0,
    2,
  ],
  ["Fuzzy matching for tab titles", "search/fuzzy", "article", ["search"], "done", 20.4, 1],
  ["Mono fonts for metadata", "type/mono", "article", ["type", "design"], "seen", 22.3, 1],
  ["Device Flow login explained", "auth/device-flow", "article", ["auth"], "done", 24.0, 0],
  ["Charting time with ticks", "dataviz/ticks", "article", ["dataviz"], "seen", 25.5, 1],
  ["Habits of tidy browser tabs", "productivity/tabs", "video", ["productivity"], "done", 27.2, 2],
  ["Shipping a monorepo with turbo", "tools/turbo", "tool", ["tooling"], "seen", 28.9, 0],
];

type SeedTab = readonly [title: string, path: string, ageDays: number];

const tabs: Readonly<Record<(typeof devices)[number]["id"], ReadonlyArray<SeedTab>>> = {
  "seed-device-laptop": [
    ["Pull request: visual polish pass", "pulls/125", 0.05],
    ["Effect documentation: Layers", "docs/layers", 0.4],
    ["D1 query planner notes", "notes/d1", 1.1],
    ["Design review checklist", "design/checklist", 2.4],
    ["Quarterly planning doc", "docs/planning", 4.8],
    ["Old benchmark results", "bench/old", 9.5],
    ["Conference talk recording", "talks/edge", 12.3],
    ["Forgotten RFC draft", "rfc/draft", 18],
  ],
  "seed-device-desktop": [
    ["Recipe: weeknight noodles", "recipes/noodles", 0.7],
    ["Bike maintenance guide", "bikes/maintenance", 3.3],
    ["Train timetable", "travel/trains", 5.5],
    ["Long read on city planning", "reads/cities", 8.2],
    ["Photo editing tutorial", "photo/editing", 15],
  ],
  "seed-device-phone": [
    ["Weather this week", "weather", 0.2],
    ["Podcast episode notes", "podcasts/notes", 1.8],
    ["Museum opening hours", "museum/hours", 6.1],
    ["Saved article on sleep", "reads/sleep", 10.7],
  ],
};

const iso = (now: number, ageDays: number) => new Date(now - ageDays * day).toISOString();

/** Replaces the seeded rows with a fresh set, dated relative to now. */
export const seed = async (env: WorkerEnv): Promise<{ links: number; tabs: number }> => {
  const now = Date.now();
  const db = env.DB;
  const statements: Array<D1PreparedStatement> = [
    db.prepare("DELETE FROM links WHERE id LIKE 'seed-%'"),
    // Cascades to open_tabs, commands and api_tokens.
    db.prepare("DELETE FROM devices WHERE id LIKE 'seed-%'"),
  ];
  for (const device of devices) {
    statements.push(
      db
        .prepare(
          "INSERT INTO devices (id, name, kind, created_at, tabs_taken_at) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(device.id, device.name, device.kind, iso(now, 60), iso(now, 0.01)),
    );
  }
  links.forEach(([title, path, type, linkTags, status, ageDays, device], index) => {
    const id = `seed-link-${index}`;
    const url = `https://example.com/${path}`;
    statements.push(
      db
        .prepare(
          `INSERT INTO links (id, url, canonical_url, title, status, type, summary, language,
            source_device_id, created_at, enriched_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'en', ?, ?, ?)`,
        )
        .bind(
          id,
          url,
          url,
          title,
          status,
          type,
          `A synthetic ${type} about ${linkTags.join(" and ")}, seeded for screenshots.`,
          devices[device]?.id ?? null,
          iso(now, ageDays),
          iso(now, ageDays - 0.01),
        ),
    );
    for (const tag of linkTags) {
      statements.push(
        db.prepare("INSERT OR IGNORE INTO tags (name) VALUES (?)").bind(tag),
        db
          .prepare("INSERT INTO link_tags (link_id, tag_id) SELECT ?, id FROM tags WHERE name = ?")
          .bind(id, tag),
      );
    }
  });
  let tabCount = 0;
  for (const [deviceId, deviceTabs] of Object.entries(tabs)) {
    for (const [title, path, ageDays] of deviceTabs) {
      tabCount++;
      statements.push(
        db
          .prepare(
            "INSERT INTO open_tabs (device_id, url, title, opened_at, last_seen_at) VALUES (?, ?, ?, ?, ?)",
          )
          .bind(deviceId, `https://example.com/${path}`, title, iso(now, ageDays), iso(now, 0.01)),
      );
    }
  }
  await db.batch(statements);
  return { links: links.length, tabs: tabCount };
};
