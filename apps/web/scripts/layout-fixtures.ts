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

// The top of the list is mixed on purpose (#161): a video with a summary and more tags than fit, an
// article with a title too long for its line, a link with no image, a video with no summary, and
// a title that ends with the site's own name. Every row is still one height.
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
  [
    "A field guide to full-text search: tokenizers, ranking functions, prefix queries and what to measure before you ship it",
    "db/fts",
    "article",
    ["sqlite", "search"],
    "new",
    0.3,
    0,
  ],
  [
    "Release notes for a typed effect library",
    "effect/v4",
    "article",
    ["typescript"],
    "new",
    0.6,
    0,
  ],
  ["Designing keyboard-first web apps", "ux/keyboard", "video", ["design", "ux"], "seen", 1.2, 1],
  [
    "Static assets at the edge in practice | Example",
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

/**
 * A YouTube link, for the link page with a player (`/links/seed-link-youtube`). It is in no list.
 * The video id is invented, and the thumbnail is one of the drawn previews.
 */
export const youtubeLinkId = "seed-link-youtube";
const youtube = (now: number) => ({
  id: youtubeLinkId,
  url: "https://www.youtube.com/watch?v=synthetic01",
  canonicalUrl: null,
  title: "How central banks set interest rates, explained with one chart",
  status: "new",
  type: "video",
  summary:
    "A synthetic summary of a talk: what a policy rate is, how it reaches mortgages and savings, and why the effect arrives a year late. Long enough to wrap over a few lines of reading text.",
  language: "en",
  tags: ["economics", "explainer", "housing"],
  sourceDeviceId: devices[2].id,
  createdAt: iso(now - 3 * day),
  imageUrl: `${PreviewImages.origin}economics/central-banks.svg`,
  author: "Plain Economics",
  enrichedAt: iso(now - 3 * day + 60_000),
});

// Media that are not 16:9 (#176), outside a post: a YouTube Short (a vertical video, known from
// its URL) and an article whose og:image is a portrait (known only once it has loaded). Both are
// in the Inbox, where their previews are letterboxed, and have a page.
export const shapeLinkIds = { short: "seed-link-short", tall: "seed-link-tall" } as const;
const shapeLinks = (now: number) => [
  {
    ...youtube(now),
    id: shapeLinkIds.short,
    url: "https://www.youtube.com/shorts/synthetic02",
    title: "One chart in forty seconds: why rent follows rates",
    createdAt: iso(now - 0.5 * day),
    imageUrl: `${PreviewImages.origin}shapes/portrait.svg`,
    enrichedAt: iso(now - 0.5 * day + 60_000),
  },
  {
    ...youtube(now),
    id: shapeLinkIds.tall,
    url: "https://example.com/design/poster",
    title: "A poster for the field guide, set in one weight",
    type: "article",
    tags: ["design"],
    createdAt: iso(now - 0.6 * day),
    imageUrl: `${PreviewImages.origin}shapes/tall.svg`,
    author: "Mara Lindqvist",
    enrichedAt: iso(now - 0.6 * day + 60_000),
  },
];

// Posts on X (#170), one of each kind: words only, one photo, four photos, a video, a reply that
// quotes another post, and a post that could not be read. Invented people and words; the pictures
// are drawn previews (a person's under `avatars/`), and the video's address is never requested
// (nothing presses play).
const person = (name: string, handle: string, verified = false) => ({
  name,
  handle,
  avatarUrl: `${PreviewImages.origin}avatars/${handle}.svg`,
  verified,
});

const mara = person("Mara Lindqvist", "example_mara", true);
const plain = person("Plain Economics", "example_plain");

const postPhoto = (name: string, width = 1600, height = 900) => ({
  kind: "photo",
  url: `${PreviewImages.origin}${name.includes("/") ? name : `posts/${name}`}.svg`,
  width,
  height,
});

const postFields = (now: number, id: string, author: ReturnType<typeof person>, age: number) => ({
  id,
  url: `https://x.com/${author.handle}/status/${id}`,
  author,
  entities: [] as ReadonlyArray<object>,
  createdAt: iso(now - age * day),
  media: [] as ReadonlyArray<object>,
  replyTo: null as string | null,
  counts: { likes: 1284, replies: 56 } as object | null,
  long: false,
});

/** `text` with an entity for each part that should be a link. */
const withEntities = (text: string, parts: ReadonlyArray<readonly [string, string, string]>) => ({
  text,
  entities: parts.map(([part, kind, url]) => ({
    kind,
    start: text.indexOf(part),
    end: text.indexOf(part) + part.length,
    url,
  })),
});

export const postLinkIds = {
  text: "seed-post-text",
  photo: "seed-post-photo",
  photos: "seed-post-photos",
  video: "seed-post-video",
  quote: "seed-post-quote",
  unavailable: "seed-post-unavailable",
  // Media of other shapes (#176): a vertical video, a portrait photo, a square and a panorama.
  // The 16:9 one is `video`.
  portraitVideo: "seed-post-portrait-video",
  portraitPhoto: "seed-post-portrait-photo",
  square: "seed-post-square",
  panorama: "seed-post-panorama",
} as const;

const postLinks = (now: number) => {
  const link = (
    id: string,
    age: number,
    status: string,
    tags: ReadonlyArray<string>,
    post: ReturnType<typeof postFields> & { readonly text: string; readonly quoted?: object },
    imageUrl: string | null = null,
  ) => ({
    id,
    url: post.url,
    canonicalUrl: post.url,
    title: `${post.author.name}: ${post.text.split("\n")[0]}`,
    status,
    type: "other",
    summary: post.text,
    language: "en",
    tags,
    sourceDeviceId: devices[2].id,
    createdAt: iso(now - age * day),
    imageUrl,
    author: `@${post.author.handle}`,
    enrichedAt: iso(now - age * day + 60_000),
    post: { state: "available", quoted: null, ...post },
  });
  const gone = `https://x.com/${plain.handle}/status/1700000000000000016`;
  return [
    link(postLinkIds.text, 0.2, "new", ["economics", "housing"], {
      ...postFields(now, "1700000000000000011", mara, 0.4),
      ...withEntities(
        "An example thought about housing: rates move prices a year late, and everyone is surprised each time.\n\nThe chart is at example.com/rates, with thanks to @example_plain #economics",
        [
          ["example.com/rates", "link", "https://example.com/economics/rates"],
          ["@example_plain", "mention", "https://x.com/example_plain"],
          ["#economics", "hashtag", "https://x.com/hashtag/economics"],
        ],
      ),
    }),
    link(
      postLinkIds.photo,
      0.7,
      "new",
      ["design"],
      {
        ...postFields(now, "1700000000000000012", plain, 0.9),
        text: "An example photo from the field trip. The light did all the work.",
        media: [postPhoto("field", 1600, 1200)],
      },
      `${PreviewImages.origin}posts/field.svg`,
    ),
    link(
      postLinkIds.photos,
      1.1,
      "seen",
      ["design", "ux"],
      {
        ...postFields(now, "1700000000000000013", mara, 1.3),
        text: "Four example screens of the keyboard-first inbox, before and after.",
        media: ["before", "after", "detail", "phone"].map((name) => postPhoto(name)),
      },
      `${PreviewImages.origin}posts/before.svg`,
    ),
    link(
      postLinkIds.video,
      1.4,
      "new",
      ["economics"],
      {
        ...postFields(now, "1700000000000000014", plain, 1.6),
        text: "An example clip: one chart, forty seconds, how a policy rate reaches a mortgage.",
        media: [
          {
            kind: "video",
            posterUrl: `${PreviewImages.origin}posts/clip.svg`,
            videoUrl: "https://example.com/previews/posts/clip.mp4",
            width: 1920,
            height: 1080,
            durationMs: 40_000,
          },
        ],
      },
      `${PreviewImages.origin}posts/clip.svg`,
    ),
    link(postLinkIds.quote, 2.4, "seen", ["search"], {
      ...postFields(now, "1700000000000000015", mara, 2.6),
      text: "Agreed with this example, and the second point matters more than it looks.",
      replyTo: plain.handle,
      counts: { likes: 12, replies: null },
      quoted: {
        ...postFields(now, "1700000000000000010", plain, 3),
        text: "An example claim: search by meaning finds what you forgot the words for, and keyword search finds what you remember exactly.",
        counts: null,
      },
    }),
    link(
      postLinkIds.portraitVideo,
      0.3,
      "new",
      ["economics"],
      {
        ...postFields(now, "1700000000000000017", mara, 0.5),
        text: "An example clip filmed on a phone: the whole argument, standing up, in thirty seconds.",
        media: [
          {
            kind: "video",
            posterUrl: `${PreviewImages.origin}shapes/portrait.svg`,
            videoUrl: "https://example.com/previews/shapes/portrait.mp4",
            width: PreviewImages.shapes.portrait[0],
            height: PreviewImages.shapes.portrait[1],
            durationMs: 30_000,
          },
        ],
      },
      `${PreviewImages.origin}shapes/portrait.svg`,
    ),
    link(
      postLinkIds.portraitPhoto,
      0.8,
      "seen",
      ["design"],
      {
        ...postFields(now, "1700000000000000018", plain, 1),
        text: "An example portrait from the same trip, taken upright.",
        media: [postPhoto("shapes/tall", ...PreviewImages.shapes.tall)],
      },
      `${PreviewImages.origin}shapes/tall.svg`,
    ),
    link(
      postLinkIds.square,
      1.2,
      "seen",
      ["design"],
      {
        ...postFields(now, "1700000000000000019", mara, 1.4),
        text: "An example square crop, the way a camera app likes it.",
        media: [postPhoto("shapes/square", ...PreviewImages.shapes.square)],
      },
      `${PreviewImages.origin}shapes/square.svg`,
    ),
    link(
      postLinkIds.panorama,
      1.5,
      "new",
      ["design"],
      {
        ...postFields(now, "1700000000000000020", plain, 1.7),
        text: "An example panorama: three frames of the ridge stitched into one.",
        media: [postPhoto("shapes/panorama", ...PreviewImages.shapes.panorama)],
      },
      `${PreviewImages.origin}shapes/panorama.svg`,
    ),
    {
      id: postLinkIds.unavailable,
      url: gone,
      canonicalUrl: gone,
      title: null,
      status: "seen",
      type: "other",
      summary: null,
      language: null,
      tags: [] as ReadonlyArray<string>,
      sourceDeviceId: devices[0].id,
      createdAt: iso(now - 2.8 * day),
      imageUrl: null,
      author: `@${plain.handle}`,
      enrichedAt: iso(now - 2.8 * day + 60_000),
      post: { state: "unavailable", id: "1700000000000000016", url: gone },
    },
  ];
};

type AnyLink =
  | ReturnType<typeof links>[number]
  | ReturnType<typeof shapeLinks>[number]
  | ReturnType<typeof postLinks>[number];

/** Seeded links for the link page: an article with an og:image, and one with no image. */
export const articleLinkId = "seed-link-2";
export const coverLinkId = "seed-link-3";

/**
 * What Open now shows (#181). `default` is the seeded account: three devices, tabs of every age
 * (some stale, some the browser gave no age for) and a few that are already saved links. `many`
 * is one browser with a long list, `two` two devices and nothing stale.
 */
export type TabsScene = "default" | "many" | "two";

type TabSeed = readonly [title: string | null, url: string, openDays: number | null];

/** Tabs sit on several sites, so the rows show more than one favicon. */
const tabSites = ["example.org", "docs.example.com", "news.example.net", "example.com"];

// Addresses of seeded links (`seeds`): these tabs are saved, one with a preview and one without.
const savedTabs: ReadonlyArray<TabSeed> = [
  ["How interest rates move housing prices", "https://example.com/economics/rates", 0.2],
  ["Release notes for a typed effect library", "https://example.com/effect/v4#whats-new", 2],
  ["Designing keyboard-first web apps", "https://example.com/ux/keyboard", 9],
];

const tabTitles = [
  "Pull request: compact rows for open tabs",
  "Sticky positioning and scroll containers, a reference with every edge case we could find",
  "Weekly planning board",
  "Pointer events on touch screens | Docs",
  "Quarterly numbers, draft 3",
  "A gentle introduction to queues",
  "Flights to Lisbon in May",
  "Changelog",
  "How to season a cast iron pan",
  "Design review notes",
  "Issue: favicon falls back to the initial",
  "Typography scale calculator",
];

const madeTabs = (count: number, offset: number, ages: ReadonlyArray<number | null>) =>
  Array.from({ length: count }, (_, t): TabSeed => {
    const site = tabSites[(offset + t) % tabSites.length]!;
    return [
      tabTitles[(offset * 5 + t) % tabTitles.length]!,
      `https://${site}/tabs/${offset}-${t}`,
      ages[t % ages.length]!,
    ];
  });

const tabScenes: Readonly<Record<TabsScene, ReadonlyArray<ReadonlyArray<TabSeed>>>> = {
  default: [
    [
      savedTabs[0]!,
      ...madeTabs(4, 0, [0.02, 0.4, 1.5, 3]),
      savedTabs[1]!,
      ...madeTabs(2, 4, [9, 12]),
    ],
    [
      ...madeTabs(3, 1, [0.2, null, 5]),
      savedTabs[2]!,
      ["Old spreadsheet", "https://example.org/sheets/2019", 16],
    ],
    // No title, and no age from the browser: the row shows the address and says nothing of time.
    [
      ...madeTabs(2, 2, [null]),
      [null, "https://news.example.net/live/markets", null],
      ...madeTabs(1, 7, [10]),
    ],
  ],
  many: [[savedTabs[0]!, ...madeTabs(23, 3, [0.01, 0.1, 0.3, 0.9, 1.2, 2, 3.5, 5, 6.5])]],
  two: [madeTabs(6, 0, [0.05, 0.5, 1, 2, 4, 6]), [savedTabs[1]!, ...madeTabs(3, 5, [0.1, 3, 6])]],
};

// The address the api matches a tab's page by, near enough for the fixtures: no fragment.
const pageOf = (url: string) => url.replace(/#.*$/, "");

/**
 * Every device's tabs, and which are saved (the api's `saved`, by the seeded links' addresses).
 * In the default scene the first device (a browser) has two windows and says when each tab was
 * last active; the others report neither, as Safari's iCloud Tabs don't.
 */
export const tabs = (
  now: number,
  scene: TabsScene,
  stored: ReadonlyArray<{
    readonly id: string;
    readonly url: string;
    readonly imageUrl: string | null;
  }> = [],
) => ({
  devices: tabScenes[scene].map((seeded, d) => {
    const device = devices[d]!;
    const windows = scene === "default" && d === 0;
    const openTabs = seeded.map(([title, url, openDays], t) => ({
      url,
      title,
      openedAt: openDays === null ? null : iso(now - openDays * day),
      lastSeenAt: iso(now - 60_000),
      ...(windows
        ? { window: { id: t < 5 ? "1" : "2" }, lastActiveAt: iso(now - (t * 7 + 1) * 60_000) }
        : {}),
    }));
    return {
      device: { ...device, createdAt: iso(now - 40 * day) },
      snapshot: {
        deviceId: device.id,
        // The first device synced a moment ago, the others a while back.
        takenAt: iso(now - [20_000, 7 * 60_000, 3 * 60 * 60_000][d]!),
        tabs: openTabs,
      },
      saved: openTabs.flatMap((tab) => {
        const link = stored.find((l) => pageOf(l.url) === pageOf(tab.url));
        return link === undefined
          ? []
          : [{ url: tab.url, linkId: link.id, imageUrl: link.imageUrl }];
      }),
    };
  }),
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

const activity = (now: number, all: ReadonlyArray<AnyLink>) =>
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

const listLinks = (all: ReadonlyArray<AnyLink>, url: URL) => {
  const q = url.searchParams;
  const items = [...all]
    // Newest first, as the api lists them: the posts sit among the other links.
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .filter((link) => (q.get("seen") === "false" ? link.status === "new" : true))
    .filter((link) => (q.has("status") ? link.status === q.get("status") : true))
    .filter((link) => (q.has("type") ? link.type === q.get("type") : true))
    .filter((link) => (q.has("tag") ? link.tags.includes(q.get("tag")!) : true))
    .slice(0, Number(q.get("limit") ?? 50));
  return { items, nextCursor: null };
};

const search = (all: ReadonlyArray<AnyLink>, url: URL) => {
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

// The owner's account and what Settings → Members shows (#177): the owner, one member and one
// invite link nobody has used yet.
const account = (now: number) => ({
  id: "owner",
  displayName: "example-user",
  role: "owner",
  createdAt: iso(now - 90 * day),
  dailyAiQuota: null,
  ai: { dailyQuota: null, usedToday: 4, waiting: 0, resetsAt: iso(now + day) },
});

const members = (now: number, linkCount: number) => [
  { ...account(now), ai: undefined, links: linkCount },
  {
    id: "seed-member-1",
    displayName: "example-friend",
    role: "member",
    createdAt: iso(now - 12 * day),
    dailyAiQuota: 200,
    links: 37,
  },
];

const invites = (now: number) => [
  {
    id: "seed-invite-1",
    createdAt: iso(now - 2 * day),
    expiresAt: iso(now + 5 * day),
    revokedAt: null,
    acceptedAt: null,
    acceptedBy: null,
  },
];

/** The api with the seeded data. `tabs` picks what Open now shows (see `TabsScene`). */
export const seeded = (now: number, options: { readonly tabs?: TabsScene } = {}): Fixtures => {
  const all = [...links(now), ...shapeLinks(now), ...postLinks(now)];
  return {
    answer: (method, url) => {
      const path = url.pathname.replace(/^\/api/, "");
      if (method === "POST" && path === "/links") return saved(now);
      // "Save all" on Open now: the audit and the screenshots only need an answer.
      if (method === "POST" && path === "/links/batch") return { links: [] };
      if (method !== "GET") return undefined;
      if (path === "/auth/me") return me;
      if (path === "/devices/activity") return activity(now, all);
      if (path === "/connect/info") return info;
      if (path === "/links") return listLinks(all, url);
      if (path === `/links/${youtubeLinkId}`) return youtube(now);
      if (path.startsWith("/links/")) return all.find((link) => `/links/${link.id}` === path);
      if (path === "/devices")
        return devices.map((d) => ({ ...d, createdAt: iso(now - 40 * day) }));
      if (path === "/tabs") return tabs(now, options.tabs ?? "default", all);
      if (path === "/tokens") return tokens(now);
      if (path === "/search") return search(all, url);
      if (path === "/members/me") return account(now);
      if (path === "/members") return members(now, all.length);
      if (path === "/invites") return invites(now);
      return undefined;
    },
  };
};

/** The api of a first-run user at `now`: signed in, nothing saved, no devices. */
export const empty = (now: number): Fixtures => ({
  answer: (method, url) => {
    if (method !== "GET") return undefined;
    const path = url.pathname.replace(/^\/api/, "");
    if (path === "/auth/me") return me;
    if (path === "/links") return { items: [], nextCursor: null };
    if (path === "/devices" || path === "/tokens" || path === "/devices/activity") return [];
    if (path === "/connect/info") return info;
    if (path === "/tabs") return { devices: [] };
    if (path === "/search") return { hits: [] };
    // The owner alone: no members, no invites.
    if (path === "/members/me") return account(now);
    if (path === "/members") return members(now, 0).slice(0, 1);
    if (path === "/invites") return [];
    return undefined;
  },
});

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
  // `now` moves on as the walk does: a first save or use comes after the page has opened.
  const startedAt = performance.now();
  const later = () => iso(now + Math.round(performance.now() - startedAt) + 1000);
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
    const at = later();
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
      lastUsedAt: later(),
    });
  /** The devices the guides registered, newest last. */
  const devices = (): ReadonlyArray<Created> => created;
  return { answer, arrive, useClaude, devices };
};
