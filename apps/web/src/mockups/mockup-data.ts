import * as Thumbs from "./mockup-thumbs.ts";

// Made-up links for the mockups of #148: videos with thumbnails, articles with an og:image, and
// links with no image at all. Nothing here is a real page, channel or author.

export interface MockLink {
  readonly id: string;
  readonly title: string;
  /** The site, as shown: no scheme, no `www.`. */
  readonly host: string;
  /** The channel or author, when the page names one. */
  readonly by?: string;
  readonly age: string;
  readonly device: string;
  readonly image?: string;
  readonly video?: boolean;
  readonly unread?: boolean;
  /** Absent while the link is still being summarized, or when the page had nothing to say. */
  readonly summary?: string;
  readonly tags: ReadonlyArray<string>;
}

const rates: MockLink = {
  id: "rates",
  title: "How interest rates move housing prices, explained with one chart",
  host: "youtube.com",
  by: "Plain Economics",
  age: "2h",
  device: "iPhone",
  image: Thumbs.chart("#12324a", "#ffb347"),
  video: true,
  unread: true,
  summary:
    "Walks through why mortgage costs react to the policy rate within weeks while prices take years, using thirty years of data from four countries.",
  tags: ["economics", "housing", "explainer", "data", "long"],
};

const sqlite: MockLink = {
  id: "sqlite",
  title: "A field guide to SQLite full-text search",
  host: "example.com",
  by: "Mara Lindqvist",
  age: "5h",
  device: "Work laptop",
  image: Thumbs.card("#f4e9d8", "#2b2118", "example.com", "FTS5 field guide"),
  unread: true,
  summary:
    "Tokenizers, ranking with bm25 and the three index layouts worth knowing, with queries you can paste.",
  tags: ["sqlite", "search"],
};

const effect: MockLink = {
  id: "effect",
  title: "Effect v4 release notes",
  host: "example.dev",
  age: "7h",
  device: "Work laptop",
  unread: true,
  summary: "What moved out of the platform package, the new schema checks and how to migrate.",
  tags: ["effect", "typescript"],
};

const pending: MockLink = {
  id: "pending",
  title: "example.org/notes/2026/reading-list",
  host: "example.org",
  age: "9h",
  device: "iPhone",
  unread: true,
  tags: [],
};

const keyboard: MockLink = {
  id: "keyboard",
  title: "Designing keyboard-first web apps: focus, shortcuts and the command menu",
  host: "youtube.com",
  by: "Interface Club",
  age: "1d",
  device: "Home desktop",
  image: Thumbs.talk("#1d1b2e", "#8f7bff", ["KEYBOARD", "FIRST"]),
  video: true,
  summary:
    "A conference talk on focus order, discoverable shortcuts and when a command menu beats a toolbar.",
  tags: ["design", "ux", "talk"],
};

const assets: MockLink = {
  id: "assets",
  title: "Workers Static Assets in practice",
  host: "example.net",
  by: "Jonas Reiter",
  age: "1d",
  device: "Work laptop",
  image: Thumbs.card("#f26b21", "#ffffff", "example.net", "Static Assets"),
  summary: "Routing a single-page app and its api from one Worker, and what the cache does.",
  tags: ["cloudflare"],
};

const fonts: MockLink = {
  id: "fonts",
  title: "Variable fonts on the web",
  host: "example.com",
  age: "1d",
  device: "iPhone",
  image: Thumbs.photo("#f3d9c4", "#ef6f4a", "#3c2f4f", "#8a6a8f"),
  summary: "One file, every weight: axes, fallbacks and the loading strategy that avoids a flash.",
  tags: ["design", "type"],
};

const inflation: MockLink = {
  id: "inflation",
  title: "Почему инфляция ощущается по-разному в разных городах",
  host: "youtube.com",
  by: "Простая экономика",
  age: "2d",
  device: "iPhone",
  image: Thumbs.talk("#0f2a1f", "#43d17a", ["ЦЕНЫ", "И ГОРОДА"]),
  video: true,
  summary:
    "Разбор того, как аренда, транспорт и еда по-разному входят в корзину и почему средняя цифра мало что говорит.",
  tags: ["economics", "ru"],
};

const oxlint: MockLink = {
  id: "oxlint",
  title: "oxlint rules worth turning on",
  host: "example.dev",
  age: "2d",
  device: "Work laptop",
  image: Thumbs.code("#1b2233", "#79c0ff"),
  summary: "A short list of rules that catch real bugs, with the config for a monorepo.",
  tags: ["tooling", "typescript"],
};

const dumps: MockLink = {
  id: "dumps",
  title: "A tiny CLI for SQLite dumps",
  host: "example.org",
  by: "small-tools",
  age: "2d",
  device: "Home desktop",
  tags: ["sqlite", "tooling", "repo"],
};

export interface MockDay {
  readonly label: string;
  readonly links: ReadonlyArray<MockLink>;
}

export const days: ReadonlyArray<MockDay> = [
  { label: "Today", links: [rates, sqlite, effect, pending] },
  { label: "Yesterday", links: [keyboard, assets, fonts] },
  { label: "Mon, Nov 16", links: [inflation, oxlint, dumps] },
];

/** The id of the row shown as the one the keyboard is on. */
export const selectedId = keyboard.id;

const bank: MockLink = {
  id: "bank",
  title: "What a central bank actually does",
  host: "youtube.com",
  by: "Plain Economics",
  age: "3w",
  device: "Home desktop",
  image: Thumbs.talk("#2a1a12", "#ff9d5c", ["CENTRAL", "BANKS"]),
  video: true,
  summary:
    "The balance sheet, the policy rate and the corridor, without jargon: the economics of money in forty minutes.",
  tags: ["economics", "explainer"],
};

const openSource: MockLink = {
  id: "open-source",
  title: "The economics of open source",
  host: "example.com",
  by: "Mara Lindqvist",
  age: "10d",
  device: "Work laptop",
  image: Thumbs.card("#1f3d2b", "#e8f5e9", "example.com", "Who pays?"),
  summary:
    "Who pays for maintenance, and why sponsorship follows usage so loosely. Three funding models compared.",
  tags: ["economics", "open-source"],
};

const pricing: MockLink = {
  id: "pricing",
  title: "Pricing notes for a small tool",
  host: "example.org",
  age: "2mo",
  device: "iPhone",
  summary: "A founder's notes on unit economics, free tiers and when to charge per seat.",
  tags: ["business"],
};

/** What "economics" finds, best match first. */
export const query = "economics";
export const results: ReadonlyArray<MockLink> = [rates, bank, openSource, inflation, pricing];

export const recentSearches: ReadonlyArray<{ readonly query: string; readonly age: string }> = [
  { query: "that video about economics", age: "2h" },
  { query: "sqlite full-text search", age: "1d" },
  { query: "keyboard shortcuts talk", age: "3d" },
  { query: "variable fonts", age: "1w" },
];

export const recentLinks: ReadonlyArray<MockLink> = [rates, sqlite, effect];
