// Synthetic preview images for the screenshots and the layout audit: small SVG pictures drawn
// here, so no real thumbnail ever enters the repo and the scripts need no network. They stand in
// for a video frame, an article's og:image and a photo. The seeded links name them as
// `https://example.com/previews/<name>.svg` (`origin`), and the scripts answer those requests in
// the browser with `forUrl`.

/** Where the seeded links' preview images live. Nothing is ever fetched from there. */
export const origin = "https://example.com/previews/";

const uri = (body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice">${body}</svg>`;

const text = (x: number, y: number, size: number, fill: string, value: string, weight = 700) =>
  `<text x="${x}" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}">${value}</text>`;

/** A talking-head video frame: a presenter on the right, a big caption on the left. */
export const talk = (background: string, accent: string, caption: readonly [string, string]) =>
  uri(
    `<rect width="320" height="180" fill="${background}"/>` +
      `<circle cx="236" cy="78" r="34" fill="#e8c7a8"/>` +
      `<path d="M168 180c4-44 32-62 68-62s64 18 68 62z" fill="${accent}"/>` +
      `<path d="M202 70c2-26 20-38 36-38s34 10 34 36c-12-14-44-16-70 2z" fill="#3a2a22"/>` +
      text(16, 82, 25, "#ffffff", caption[0]) +
      text(16, 112, 25, accent, caption[1]),
  );

/** A chart explainer: bars and a trend line on a dark board. */
export const chart = (background: string, accent: string) =>
  uri(
    `<rect width="320" height="180" fill="${background}"/>` +
      [0, 1, 2, 3, 4, 5, 6]
        .map((index) => {
          const height = 30 + ((index * 37) % 70) + index * 6;
          return `<rect x="${28 + index * 40}" y="${156 - height}" width="24" height="${height}" rx="3" fill="#ffffff" fill-opacity="0.22"/>`;
        })
        .join("") +
      `<polyline points="28,120 68,104 108,112 148,76 188,84 228,48 292,28" fill="none" stroke="${accent}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>` +
      `<circle cx="292" cy="28" r="9" fill="${accent}"/>`,
  );

/** A screen recording: an editor window with lines of code. */
export const code = (background: string, accent: string) =>
  uri(
    `<rect width="320" height="180" fill="${background}"/>` +
      `<rect x="24" y="22" width="272" height="136" rx="10" fill="#0d1017"/>` +
      `<circle cx="42" cy="38" r="4" fill="#ff5f57"/><circle cx="56" cy="38" r="4" fill="#febc2e"/><circle cx="70" cy="38" r="4" fill="#28c840"/>` +
      [
        [40, 120, accent],
        [56, 168, "#8b949e"],
        [56, 96, "#7ee787"],
        [72, 140, "#8b949e"],
        [56, 110, accent],
        [40, 64, "#8b949e"],
      ]
        .map(
          ([x, width, fill], index) =>
            `<rect x="${x}" y="${58 + index * 15}" width="${width}" height="7" rx="3.5" fill="${fill}"/>`,
        )
        .join(""),
  );

/** An article's og:image: the site's card with a headline set in blocks of colour. */
export const card = (background: string, foreground: string, site: string, headline: string) =>
  uri(
    `<rect width="320" height="180" fill="${background}"/>` +
      `<rect x="24" y="24" width="18" height="18" rx="4" fill="${foreground}"/>` +
      text(50, 39, 15, foreground, site, 600) +
      text(24, 104, 30, foreground, headline) +
      `<rect x="24" y="124" width="150" height="8" rx="4" fill="${foreground}" fill-opacity="0.45"/>` +
      `<rect x="24" y="140" width="96" height="8" rx="4" fill="${foreground}" fill-opacity="0.45"/>`,
  );

/** A photo: sky, sun and two ridges. */
export const photo = (sky: string, sun: string, near: string, far: string) =>
  uri(
    `<rect width="320" height="180" fill="${sky}"/>` +
      `<circle cx="232" cy="64" r="26" fill="${sun}"/>` +
      `<path d="M0 132l56-44 48 30 62-52 70 58 84-40v96H0z" fill="${far}"/>` +
      `<path d="M0 156l70-34 60 22 76-40 114 46v30H0z" fill="${near}"/>`,
  );

/**
 * A picture of a given size, for media that are not 16:9 (#176): a person against a sky, with the
 * face in the upper third and the shirt below. A centre crop to 16:9 would show the shirt only.
 * The SVG states its size, so the browser reports the real shape when it has loaded.
 */
export const figure = (width: number, height: number, sky: string, shirt: string) => {
  const unit = Math.min(width, height);
  const cx = width / 2;
  const cy = height * 0.3;
  const head = unit * 0.17;
  const shoulders = Math.min(width * 0.42, unit * 0.6);
  const top = cy + head * 1.25;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="${width}" height="${height}" fill="${sky}"/>` +
    `<circle cx="${width * 0.82}" cy="${height * 0.14}" r="${unit * 0.07}" fill="#ffd166"/>` +
    `<path d="M0 ${height * 0.62}L${width * 0.2} ${height * 0.5}L${width * 0.38} ${height * 0.6}L${width * 0.7} ${height * 0.46}L${width} ${height * 0.58}V${height}H0z" fill="#000000" fill-opacity="0.18"/>` +
    `<path d="M${cx - shoulders} ${height}C${cx - shoulders} ${top + head * 0.4} ${cx - head} ${top} ${cx} ${top}S${cx + shoulders} ${top + head * 0.4} ${cx + shoulders} ${height}z" fill="${shirt}"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${head}" fill="#e8c7a8"/>` +
    `<path d="M${cx - head} ${cy - head * 0.1}a${head} ${head} 0 0 1 ${head * 2} 0c-${head * 0.5}-${head * 0.5}-${head * 1.5}-${head * 0.5}-${head * 2} 0z" fill="#3a2a22"/>` +
    `</svg>`
  );
};

/** The shapes of `…/previews/shapes/<name>.svg`, as width and height in pixels. */
export const shapes = {
  portrait: [1080, 1920],
  tall: [900, 1600],
  square: [1200, 1200],
  panorama: [3000, 1000],
  wide: [1920, 1080],
} as const satisfies Record<string, readonly [number, number]>;

const shapeColors: Readonly<Record<keyof typeof shapes, readonly [string, string]>> = {
  portrait: ["#7fb7d9", "#c2410c"],
  tall: ["#b9a6e0", "#1f6f5c"],
  square: ["#f3d9c4", "#2f4858"],
  panorama: ["#9ad1c0", "#5b3a8c"],
  wide: ["#f2c078", "#12324a"],
};

const shaped = (path: string): string | undefined => {
  const name = /\/shapes\/([a-z]+)\.svg$/.exec(path)?.[1];
  if (name === undefined || !Object.hasOwn(shapes, name)) return undefined;
  const key = name as keyof typeof shapes;
  return figure(shapes[key][0], shapes[key][1], ...shapeColors[key]);
};

/** A person's picture: a square in one colour with a head and shoulders. */
export const avatar = (background: string, foreground: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">` +
  `<rect width="200" height="200" fill="${background}"/>` +
  `<circle cx="100" cy="82" r="38" fill="${foreground}"/>` +
  `<path d="M24 200c0-44 34-70 76-70s76 26 76 70z" fill="${foreground}"/></svg>`;

const avatars: ReadonlyArray<string> = [
  avatar("#2f4858", "#f6ae2d"),
  avatar("#5b3a8c", "#e9d8fd"),
  avatar("#1f6f5c", "#d1fae5"),
];

const pictures: ReadonlyArray<string> = [
  chart("#12324a", "#ffb347"),
  card("#f4e9d8", "#2b2118", "example.com", "Field guide"),
  talk("#1b1b3a", "#8b7bff", ["KEYBOARD", "FIRST"]),
  card("#f97316", "#ffffff", "example.net", "In practice"),
  photo("#f3d9c4", "#ef6f4f", "#4a3b5c", "#8a6f8f"),
  talk("#10261c", "#3ddc84", ["ЦЕНЫ", "И ГОРОДА"]),
  code("#16213e", "#6cb6ff"),
  card("#1f3d2b", "#e8f5e9", "example.com", "Who pays?"),
  talk("#2a1a12", "#ff9d5c", ["CENTRAL", "BANKS"]),
];

/** The SVG for a preview URL: always the same picture for the same URL. */
export const forUrl = (url: string): string => {
  let sum = 0;
  const path = new URL(url).pathname;
  for (const char of path) sum = (sum * 31 + char.charCodeAt(0)) >>> 0;
  const shape = shaped(path);
  if (shape !== undefined) return shape;
  // `…/previews/avatars/<name>.svg` is a person's picture.
  return path.includes("/avatars/")
    ? avatars[sum % avatars.length]!
    : pictures[sum % pictures.length]!;
};

// Favicons. The app asks a tab's site for `/favicon.ico`. Playwright aborts every request whose
// URL ends in `/favicon.ico` before a route sees it, so the scripts could never answer one (and
// every tab would show its initial). `faviconShim` runs in the page before the app and adds
// `?drawn` to such an image URL; the scripts then answer it with `favicon`. Either way nothing is
// fetched from the network.

/**
 * An init script (a string, so no script here names the DOM globals): an `<img>` pointed at
 * `…/favicon.ico` asks for `…/favicon.ico?drawn` instead.
 */
export const faviconShim = `(() => {
  const drawn = (value) =>
    typeof value === "string" && value.endsWith("/favicon.ico") ? value + "?drawn" : value;
  const proto = HTMLImageElement.prototype;
  const src = Object.getOwnPropertyDescriptor(proto, "src");
  Object.defineProperty(proto, "src", {
    ...src,
    set(value) {
      src.set.call(this, drawn(value));
    },
  });
  const setAttribute = proto.setAttribute;
  proto.setAttribute = function (name, value) {
    return setAttribute.call(this, name, name === "src" ? drawn(value) : value);
  };
})();`;

/** Whether a request asks a synthetic site (`example.com`, `docs.example.org`, …) for its icon. */
export const isFavicon = (url: URL): boolean =>
  url.pathname === "/favicon.ico" &&
  url.search === "?drawn" &&
  /(^|\.)example\.(com|org|net)$/.test(url.hostname);

const faviconColors: ReadonlyArray<readonly [background: string, mark: string]> = [
  ["#2563eb", "#ffffff"],
  ["#f97316", "#ffffff"],
  ["#111827", "#facc15"],
  ["#16a34a", "#ffffff"],
  ["#e11d48", "#ffffff"],
  ["#f4e9d8", "#2b2118"],
  ["#7c3aed", "#ffffff"],
];

const faviconMarks: ReadonlyArray<(fill: string) => string> = [
  (fill) => `<circle cx="16" cy="16" r="7" fill="${fill}"/>`,
  (fill) => `<path d="M9 23V9h6l8 14z" fill="${fill}"/>`,
  (fill) =>
    `<rect x="9" y="9" width="14" height="5" rx="1.5" fill="${fill}"/><rect x="9" y="18" width="9" height="5" rx="1.5" fill="${fill}"/>`,
  (fill) => `<path d="M16 7l9 9-9 9-9-9z" fill="${fill}"/>`,
  (fill) => `<path d="M12 9l12 7-12 7z" fill="${fill}"/>`,
];

/**
 * The favicon of a synthetic site, drawn here: a coloured square with a simple mark, always the
 * same for the same host. The scripts answer `https://<host>/favicon.ico?drawn` with it.
 */
export const favicon = (url: string): string => {
  let sum = 0;
  for (const char of new URL(url).hostname) sum = (sum * 31 + char.charCodeAt(0)) >>> 0;
  const [background, mark] = faviconColors[sum % faviconColors.length]!;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">` +
    `<rect width="32" height="32" rx="7" fill="${background}"/>` +
    faviconMarks[(sum >>> 3) % faviconMarks.length]!(mark) +
    `</svg>`
  );
};
