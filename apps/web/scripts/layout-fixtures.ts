// Synthetic api answers for the layout audit (`scripts/layout-audit.ts`): the same picture as the
// screenshot seed (`/_smoke/seed`: three devices, a month of links with tags and statuses, open
// tabs of every age, tokens), served from the browser so the audit needs no api. Everything is
// invented: example.com URLs, made-up titles and device names. Ages are relative to `now`.

const day = 24 * 60 * 60 * 1000;

interface Fixtures {
  readonly answer: (method: string, url: URL) => unknown;
}

const devices = [
  { id: "seed-device-laptop", name: "Work laptop", kind: "zen" },
  { id: "seed-device-desktop", name: "Home desktop", kind: "zen" },
  { id: "seed-device-phone", name: "iPhone", kind: "ios" },
] as const;

type Seed = readonly [
  title: string,
  path: string,
  type: string,
  tags: ReadonlyArray<string>,
  status: "new" | "seen" | "done",
  ageDays: number,
  device: number,
];

const seeds: ReadonlyArray<Seed> = [
  [
    "How interest rates move housing prices",
    "economics/rates",
    "video",
    ["economics"],
    "new",
    0.1,
    2,
  ],
  ["A field guide to full-text search", "db/fts", "article", ["sqlite", "search"], "new", 0.3, 0],
  [
    "Release notes for a typed effect library",
    "effect/v4",
    "article",
    ["typescript"],
    "new",
    0.6,
    0,
  ],
  ["Designing keyboard-first web apps", "ux/keyboard", "article", ["design", "ux"], "seen", 1.2, 1],
  [
    "Static assets at the edge in practice",
    "edge/assets",
    "article",
    ["cloudflare"],
    "new",
    1.5,
    0,
  ],
  ["Reactivity in depth", "vue/reactivity", "video", ["vue"], "done", 2.1, 1],
  [
    "Variable fonts on the web",
    "type/variable-fonts",
    "article",
    ["design", "type"],
    "seen",
    2.6,
    2,
  ],
  ["Lint rules worth turning on", "tools/lint", "tool", ["typescript", "tooling"], "new", 3.2, 0],
  [
    "Why inflation feels different by city",
    "economics/inflation",
    "video",
    ["economics"],
    "done",
    4.5,
    2,
  ],
  ["A tiny queue for background jobs", "repo/queue", "repo", ["tooling"], "new", 6, 1],
  ["Notes on spacing scales", "design/spacing", "article", ["design"], "seen", 8, 0],
  ["Reading a balance sheet", "economics/balance-sheet", "article", ["economics"], "new", 11, 2],
  [
    "Small multiples, explained",
    "dataviz/small-multiples",
    "video",
    ["design", "dataviz"],
    "done",
    15,
    1,
  ],
  ["A command palette from scratch", "ux/palette", "repo", ["ux"], "seen", 19, 0],
  ["Embeddings for multilingual search", "search/embeddings", "article", ["search"], "new", 24, 1],
  ["The cost of a context switch", "focus/context", "other", [], "done", 28, 2],
];

const iso = (time: number) => new Date(time).toISOString();

const links = (now: number) =>
  seeds.map(([title, path, type, tags, status, age, device], i) => ({
    id: `seed-link-${i + 1}`,
    url: `https://example.com/${path}`,
    canonicalUrl: null,
    title,
    status,
    type,
    summary: `A short synthetic summary of "${title.toLowerCase()}", long enough to wrap on a phone.`,
    language: "en",
    tags,
    sourceDeviceId: devices[device]!.id,
    createdAt: iso(now - age * day),
    enrichedAt: iso(now - age * day + 60_000),
  }));

const tabAges: ReadonlyArray<ReadonlyArray<number>> = [
  [0.05, 0.4, 1.5, 3, 9, 12],
  [0.2, 2, 5, 8.5, 16],
  [0.1, 0.8, 4, 10],
];

const tabs = (now: number) => ({
  devices: devices.map((device, d) => ({
    device: { ...device, createdAt: iso(now - 40 * day) },
    snapshot: {
      deviceId: device.id,
      takenAt: iso(now - (d + 1) * 60_000),
      tabs: tabAges[d]!.map((age, t) => ({
        url: `https://example.org/${device.kind}/${d}-${t}`,
        title: `${["Reference", "Draft", "Article", "Docs", "Issue", "Video"][t % 6]} ${d + 1}.${t + 1}`,
        openedAt: iso(now - age * day),
        lastSeenAt: iso(now - 60_000),
      })),
    },
  })),
});

const tokens = (now: number) => [
  ...devices.map((device, d) => ({
    id: `seed-token-${d + 1}`,
    deviceId: device.id,
    name: null,
    createdAt: iso(now - (30 - d) * day),
    revokedAt: null,
  })),
  {
    id: "seed-token-mcp",
    deviceId: null,
    name: "Claude (MCP)",
    createdAt: iso(now - 5 * day),
    revokedAt: null,
  },
  {
    id: "seed-token-old",
    deviceId: devices[0].id,
    name: null,
    createdAt: iso(now - 60 * day),
    revokedAt: iso(now - 31 * day),
  },
];

const me = { kind: "user", login: "example" };

const listLinks = (all: ReturnType<typeof links>, url: URL) => {
  const q = url.searchParams;
  const items = all
    .filter((link) => (q.get("seen") === "false" ? link.status === "new" : true))
    .filter((link) => (q.has("status") ? link.status === q.get("status") : true))
    .filter((link) => (q.has("type") ? link.type === q.get("type") : true))
    .filter((link) => (q.has("tag") ? link.tags.includes(q.get("tag")!) : true))
    .slice(0, Number(q.get("limit") ?? 50));
  return { items, nextCursor: null };
};

const search = (all: ReturnType<typeof links>, url: URL) => {
  const terms = (url.searchParams.get("q") ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const hits = all
    .map((link) => ({
      link,
      score: terms.filter((term) =>
        `${link.title} ${link.summary} ${link.tags.join(" ")}`.toLowerCase().includes(term),
      ).length,
    }))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score);
  return { hits };
};

/** The api with the seeded data. */
export const seeded = (now: number): Fixtures => {
  const all = links(now);
  return {
    answer: (method, url) => {
      if (method !== "GET") return undefined;
      const path = url.pathname.replace(/^\/api/, "");
      if (path === "/auth/me") return me;
      if (path === "/links") return listLinks(all, url);
      if (path.startsWith("/links/")) return all.find((link) => `/links/${link.id}` === path);
      if (path === "/devices")
        return devices.map((d) => ({ ...d, createdAt: iso(now - 40 * day) }));
      if (path === "/tabs") return tabs(now);
      if (path === "/tokens") return tokens(now);
      if (path === "/search") return search(all, url);
      return undefined;
    },
  };
};

/** The api of a first-run user: signed in, nothing saved, no devices. */
export const empty: Fixtures = {
  answer: (method, url) => {
    if (method !== "GET") return undefined;
    const path = url.pathname.replace(/^\/api/, "");
    if (path === "/auth/me") return me;
    if (path === "/links") return { items: [], nextCursor: null };
    if (path === "/devices" || path === "/tokens") return [];
    if (path === "/tabs") return { devices: [] };
    if (path === "/search") return { hits: [] };
    return undefined;
  },
};
