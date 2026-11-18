import * as Link from "@stash/contracts-domain/link";
import type * as PopupLink from "@stash/ext-popup/popup-link";
import type * as PopupView from "@stash/ext-popup/popup-view";
import type * as PopupActions from "../../entrypoints/popup/popup-actions.ts";

// Made-up states of the popup for `scripts/popup-screenshots.ts`: no api, no browser. Every page,
// link and device is invented, and the previews are small SVG pictures drawn here, so no real
// thumbnail enters the repo.

const svg = (body: string, viewBox = "0 0 320 180"): string =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" preserveAspectRatio="xMidYMid slice">${body}</svg>`,
  )}`;

/** A chart on a dark board. */
const chart = (background: string, accent: string) =>
  svg(
    `<rect width="320" height="180" fill="${background}"/>` +
      [0, 1, 2, 3, 4, 5, 6]
        .map((index) => {
          const height = 30 + ((index * 37) % 70) + index * 6;
          return `<rect x="${28 + index * 40}" y="${156 - height}" width="24" height="${height}" rx="3" fill="#ffffff" fill-opacity="0.22"/>`;
        })
        .join("") +
      `<polyline points="28,120 68,104 108,112 148,76 188,84 228,48 292,28" fill="none" stroke="${accent}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`,
  );

/** An editor window with lines of code. */
const code = (background: string, accent: string) =>
  svg(
    `<rect width="320" height="180" fill="${background}"/>` +
      `<rect x="24" y="22" width="272" height="136" rx="10" fill="#0d1017"/>` +
      [
        [40, 120, accent],
        [56, 168, "#8b949e"],
        [56, 96, "#7ee787"],
        [72, 140, "#8b949e"],
        [56, 110, accent],
      ]
        .map(
          ([x, width, fill], index) =>
            `<rect x="${x}" y="${48 + index * 20}" width="${width}" height="8" rx="4" fill="${fill}"/>`,
        )
        .join(""),
  );

/** A landscape: hills under a sun. */
const hills = (sky: string, hill: string) =>
  svg(
    `<rect width="320" height="180" fill="${sky}"/>` +
      `<circle cx="236" cy="62" r="26" fill="#ffffff" fill-opacity="0.85"/>` +
      `<path d="M0 180V120c50-40 90-40 140 0s110 30 180-20v80z" fill="${hill}"/>`,
  );

const favicon = svg(
  `<rect width="32" height="32" rx="7" fill="#3b5bdb"/><path d="M9 22V10h6l8 12" fill="none" stroke="#ffffff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  "0 0 32 32",
);

const now = Date.now();
const minute = 60_000;

const link = (
  id: string,
  title: string,
  host: string,
  minutesAgo: number,
  imageUrl: string | null,
  tags: ReadonlyArray<string> = [],
): PopupLink.PopupLink => ({
  id: Link.LinkId.make(id),
  url: `https://${host}/${id}`,
  title,
  host,
  imageUrl,
  tags,
  savedAt: now - minutesAgo * minute,
  enriched: true,
});

const page: PopupView.Page = {
  url: "https://journal.example.com/notes/small-tools",
  title: "Small tools that earn their place on a crowded toolbar",
  host: "journal.example.com",
  favIconUrl: favicon,
  savable: true,
};

const recent = [
  link(
    "layers",
    "Composing services with layers, step by step",
    "docs.example.org",
    42,
    code("#1f2937", "#60a5fa"),
  ),
  link(
    "queues",
    "What a queue buys you, and what it costs",
    "example.net",
    60 * 5,
    chart("#3b1d60", "#f0abfc"),
  ),
  link(
    "walk",
    "A slow walk along the northern coast",
    "travel.example.com",
    60 * 26,
    hills("#f59e0b", "#7c2d12"),
  ),
  link("reading", "Reading list for a long winter", "example.org", 60 * 24 * 4, null),
  link(
    "sqlite",
    "Full-text search in a single file",
    "db.example.com",
    60 * 24 * 16,
    code("#0f3d2e", "#34d399"),
  ),
];

const savedPage = link("small-tools", page.title, page.host, 0, hills("#3b5bdb", "#1e2a78"), [
  "tools",
  "browser",
  "design",
]);

const connected: PopupView.Connection = {
  _tag: "Connected",
  deviceName: "Zen on the desk",
  webOrigin: "https://stash.example.com",
};

const views = {
  "not-paired": { connection: { _tag: "NotPaired" }, saved: null, recent: [] },
  paired: { connection: connected, saved: null, recent },
  saved: { connection: connected, saved: savedPage, recent: [savedPage, ...recent.slice(0, 4)] },
} satisfies Record<string, PopupView.View>;

export type State = keyof typeof views;

export const states = Object.keys(views) as ReadonlyArray<State>;

/** The popup's actions for one made-up state. Nothing leaves the page. */
export const actions = (state: State): PopupActions.Actions => ({
  page: async () => page,
  load: async () => views[state],
  save: async () => ({
    _tag: "Saved",
    link: { ...savedPage, tags: [], imageUrl: null },
    created: true,
  }),
  undo: async () => ({ _tag: "Removed" }),
  watch: async () => {},
  openStash: async () => {},
  search: async () => {},
  openLink: async () => {},
  connect: async () => {},
});
