// Synthetic previews for the mockups: small SVG pictures as data URIs, drawn here so the pages
// need no network and no real thumbnail ever enters the repo. They stand in for a video frame, an
// article's og:image and a repo card.

const uri = (body: string): string =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice">${body}</svg>`,
  )}`;

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
