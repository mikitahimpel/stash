// Synthetic api answers for the layout audit (`scripts/layout-audit.ts`): the same picture as the
// screenshot seed (`/_smoke/seed`: three devices, a month of links with tags and statuses, open
// tabs of every age, tokens), served from the browser so the audit needs no api. Everything is
// invented: example.com URLs, made-up titles, authors and device names. Ages are relative to `now`.
// Videos and some articles name a preview image under `PreviewImages.origin`, which the scripts
// answer in the browser; the rest show the placeholder tile.
import * as PreviewImages from "./preview-images.ts";

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
    // Every fourth link has no summary: a page that gave enrichment no text.
    summary:
      i % 4 === 3
        ? null
        : `A short synthetic summary of "${title.toLowerCase()}", long enough to wrap on a phone.`,
    language: "en",
    // The first link has more tags than a row shows.
    tags: i === 0 ? [...tags, "housing", "explainer", "data", "long"] : tags,
    sourceDeviceId: devices[device]!.id,
    createdAt: iso(now - age * day),
    imageUrl: type === "video" || i % 3 !== 2 ? `${PreviewImages.origin}${path}.svg` : null,
    author:
      type === "video"
        ? ["Plain Economics", "A channel with a rather long name, for truncation"][i % 2]!
        : i % 2 === 0
          ? "Mara Lindqvist"
          : null,
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
    lastUsedAt: iso(now - (d + 1) * 60_000),
  })),
  {
    id: "seed-token-mcp",
    deviceId: null,
    name: "Claude (MCP)",
    createdAt: iso(now - 5 * day),
    revokedAt: null,
    lastUsedAt: iso(now - 2 * 60 * 60_000),
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

const info = { mcpUrl: "https://mcp.example.com/mcp" };

const activity = (now: number, all: ReturnType<typeof links>) =>
  devices.map((device, d) => {
    const save = all.find((link) => link.sourceDeviceId === device.id);
    return {
      deviceId: device.id,
      lastSeenAt: iso(now - (d + 1) * 60_000),
      lastSave:
        save === undefined
          ? null
          : { at: save.createdAt, linkId: save.id, url: save.url, title: save.title },
    };
  });

/** What `POST /links` answers to `/save`: the link, as this save stored it just now. */
const saved = (now: number) => ({
  id: "seed-link-saved",
  url: "https://example.com/saved",
  canonicalUrl: null,
  title: "A page saved from the Share sheet",
  status: "new",
  type: null,
  summary: null,
  language: null,
  tags: [],
  sourceDeviceId: null,
  createdAt: iso(now),
  imageUrl: null,
  author: null,
  enrichedAt: null,
  created: true,
});

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
  const q = url.searchParams;
  const since = q.get("since");
  const hits = all
    .filter((link) => (q.has("type") ? link.type === q.get("type") : true))
    .filter((link) => (q.has("tag") ? link.tags.includes(q.get("tag")!) : true))
    .filter((link) => (q.has("deviceId") ? link.sourceDeviceId === q.get("deviceId") : true))
    .filter((link) => (since === null ? true : link.createdAt >= since))
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
      const path = url.pathname.replace(/^\/api/, "");
      if (method === "POST" && path === "/links") return saved(now);
      if (method !== "GET") return undefined;
      if (path === "/auth/me") return me;
      if (path === "/devices/activity") return activity(now, all);
      if (path === "/connect/info") return info;
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
    if (path === "/devices" || path === "/tokens" || path === "/devices/activity") return [];
    if (path === "/connect/info") return info;
    if (path === "/tabs") return { devices: [] };
    if (path === "/search") return { hits: [] };
    return undefined;
  },
};

/**
 * The recent searches of a returning user, as the app keeps them in `localStorage`
 * (`@stash/web-platform/recent-searches`): the key and its value.
 */
export const recentSearches = (now: number): readonly [key: string, value: string] => [
  "stash:recent-searches",
  JSON.stringify([
    { query: "economics", at: now - 2 * 60 * 60_000 },
    { query: "sqlite full-text search", at: now - 1.2 * day },
    { query: "that talk about keyboard shortcuts", at: now - 6 * day },
  ]),
];

interface Created {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly createdAt: string;
}

/**
 * The seeded api plus what the Connect guides write: registering devices, creating tokens and
 * approving pairings answer like the api (status 201) and show up in later reads. `arrive` and
 * `useClaude` stand in for a device's first save or check-in and Claude's first use, which the
 * guides wait for. For the Connect walk (`scripts/connect-walk.ts`).
 */
export const connectable = (now: number) => {
  const base = seeded(now);
  const created: Array<Created> = [];
  const contact = new Map<string, { lastSeenAt: string; lastSave: unknown }>();
  const tokens: Array<Record<string, unknown>> = [];
  const read = (path: string) => base.answer("GET", new URL(`http://localhost/api${path}`));
  const register = (name: string, kind: string) => {
    const device = { id: `walk-device-${created.length + 1}`, name, kind, createdAt: iso(now) };
    created.push(device);
    return device;
  };
  const answer = (
    method: string,
    url: URL,
    body: string | null,
  ): { readonly status: number; readonly body: unknown } | undefined => {
    const path = url.pathname.replace(/^\/api/, "");
    const input = (body === null || body === "" ? {} : JSON.parse(body)) as Record<string, string>;
    if (method === "POST" && path === "/devices") {
      return { status: 201, body: register(input["name"] ?? "", input["kind"] ?? "") };
    }
    if (method === "POST" && path === "/pairings") {
      return { status: 201, body: register(input["name"] ?? "", "zen") };
    }
    if (method === "POST" && path === "/tokens") {
      const token = {
        id: `walk-token-${tokens.length + 1}`,
        deviceId: input["deviceId"] ?? null,
        name: null,
        createdAt: iso(now),
        revokedAt: null,
        lastUsedAt: null,
      };
      tokens.push(token);
      return { status: 201, body: { ...token, token: `stash_synthetic_walk_${tokens.length}` } };
    }
    if (method === "GET" && path === "/devices") {
      return { status: 200, body: [...(read("/devices") as Array<unknown>), ...created] };
    }
    if (method === "GET" && path === "/devices/activity") {
      return {
        status: 200,
        body: [
          ...(read("/devices/activity") as Array<unknown>),
          ...created.map((device) => ({
            deviceId: device.id,
            ...(contact.get(device.id) ?? { lastSeenAt: null, lastSave: null }),
          })),
        ],
      };
    }
    if (method === "GET" && path === "/tokens") {
      return { status: 200, body: [...(read("/tokens") as Array<unknown>), ...tokens] };
    }
    const seededAnswer = base.answer(method, url);
    return seededAnswer === undefined
      ? undefined
      : { status: method === "POST" ? 201 : 200, body: seededAnswer };
  };
  /** The device `id` gets in touch, with a save titled `title` if given. */
  const arrive = (id: string, title?: string) => {
    const at = iso(Date.now() + 1000);
    contact.set(id, {
      lastSeenAt: at,
      lastSave:
        title === undefined
          ? null
          : { at, linkId: "walk-link", url: "https://example.com/walk", title },
    });
  };
  /** Claude uses its connector token. */
  const useClaude = () =>
    tokens.push({
      id: `walk-token-${tokens.length + 1}`,
      deviceId: null,
      name: "Claude (MCP)",
      createdAt: iso(now),
      revokedAt: null,
      lastUsedAt: iso(Date.now() + 1000),
    });
  /** The devices the guides registered, newest last. */
  const devices = (): ReadonlyArray<Created> => created;
  return { answer, arrive, useClaude, devices };
};
