// `pnpm --filter @stash/web icons`: draws every raster of the logo from the two SVGs of the kit
// (`@stash/web-ui/stash-mark.svg`, the full mark, and `stash-mark-sm.svg`, the small one made for
// 32 and 16 px) in headless Chromium, so no icon is exported by hand:
//
// - `public/favicon.svg` (a copy of the small mark), `public/icons/favicon-{16,32}.png`
// - `public/icons/apple-touch-icon.png` (180), `icon-{192,512}.png`: the full mark on an opaque
//   square of its own body colour, because iOS and Android cut the corners themselves
// - `public/icons/icon-maskable-512.png`: the same with the mark inside the maskable safe zone
// - `docs/screenshots/brand-icons.png`: every size side by side, and the 16 px favicon in a drawn
//   browser tab on dark and light, to check by eye
//
// Run it after changing either SVG and commit what it writes. `test/brand-icons.test.ts` checks
// the sizes and that the home screen icons have no transparency.
import * as Fs from "node:fs";
import * as Path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";

const appDir = Path.resolve(import.meta.dirname, "..");
const publicDir = Path.join(appDir, "public");
const sheetFile = Path.resolve(appDir, "../../docs/screenshots/brand-icons.png");

const read = (specifier: string) =>
  Fs.readFileSync(fileURLToPath(import.meta.resolve(specifier)), "utf8");
const full = read("@stash/web-ui/stash-mark.svg");
const small = read("@stash/web-ui/stash-mark-sm.svg");

const dataUrl = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

/** The body gradient of the mark (`w-body`), as the opaque square behind a home screen icon. */
const body = "linear-gradient(180deg,#32343a,#17181b)";

interface Icon {
  readonly file: string;
  readonly size: number;
  readonly svg: string;
  /** Opaque icons fill the square; `scale` is the part of it the mark takes. */
  readonly opaque?: { readonly scale: number };
}

const icons: ReadonlyArray<Icon> = [
  { file: "icons/favicon-16.png", size: 16, svg: small },
  { file: "icons/favicon-32.png", size: 32, svg: small },
  { file: "icons/apple-touch-icon.png", size: 180, svg: full, opaque: { scale: 1 } },
  { file: "icons/icon-192.png", size: 192, svg: full, opaque: { scale: 1 } },
  { file: "icons/icon-512.png", size: 512, svg: full, opaque: { scale: 1 } },
  // A maskable icon may lose everything outside the central 80% circle.
  { file: "icons/icon-maskable-512.png", size: 512, svg: full, opaque: { scale: 0.72 } },
];

const iconHtml = (icon: Icon) => {
  const side = Math.round(icon.size * (icon.opaque?.scale ?? 1));
  return `<!doctype html><style>
html,body{margin:0;background:transparent}
div{width:${icon.size}px;height:${icon.size}px;display:grid;place-items:center;${icon.opaque ? `background:${body}` : ""}}
img{display:block;width:${side}px;height:${side}px}
</style><div><img src="${dataUrl(icon.svg)}"></div>`;
};

const draw = async (page: Page, icon: Icon) => {
  await page.setViewportSize({ width: icon.size, height: icon.size });
  await page.setContent(iconHtml(icon));
  await page.locator("img").evaluate((img: HTMLImageElement) => img.decode());
  const target = Path.join(publicDir, icon.file);
  Fs.mkdirSync(Path.dirname(target), { recursive: true });
  await page.locator("div").screenshot({ path: target, omitBackground: icon.opaque === undefined });
  console.log(`✓ public/${icon.file}`);
};

/** The PNGs just written, so the sheet shows the files themselves and not a fresh rendering. */
const png = (file: string) =>
  `data:image/png;base64,${Fs.readFileSync(Path.join(publicDir, file)).toString("base64")}`;

const sheetHtml = () => {
  const tab = (theme: "dark" | "light") => `<div class="tabs ${theme}">
  <div class="tab"><img src="${png("icons/favicon-16.png")}" width="16" height="16"><span>Stash</span></div>
  <div class="tab idle"><img src="${dataUrl(small)}" width="16" height="16"><span>Stash (favicon.svg)</span></div>
</div>`;
  const zoom = (file: string, size: number) =>
    `<figure><img class="zoom" src="${png(file)}" width="${size * 6}" height="${size * 6}"><figcaption>${size} px × 6</figcaption></figure>`;
  const plain = (file: string, size: number, shown = size) =>
    `<figure><img src="${png(file)}" width="${shown}" height="${shown}"><figcaption>${Path.basename(file)} · ${size}</figcaption></figure>`;
  return `<!doctype html><style>
body{margin:0;padding:24px;width:912px;font:12px/1.4 ui-sans-serif,system-ui,sans-serif;background:#808084;color:#111}
section{display:flex;gap:24px;align-items:flex-end;flex-wrap:wrap;margin-bottom:24px}
figure{margin:0;display:grid;gap:6px;justify-items:start}
img{display:block}
.zoom{image-rendering:pixelated}
.tabs{display:flex;gap:2px;padding:8px 8px 0;border-radius:10px 10px 0 0;width:440px;box-sizing:border-box}
.tab{display:flex;align-items:center;gap:8px;height:34px;padding:0 12px;border-radius:8px 8px 0 0;font-size:12px;white-space:nowrap}
.dark{background:#1c1c1f;color:#ededed}.dark .tab{background:#35353a}.dark .idle{background:transparent;color:#a0a0a6}
.light{background:#dedee3;color:#111}.light .tab{background:#fff}.light .idle{background:transparent;color:#55555b}
.plate{display:flex;gap:16px;padding:12px;border-radius:10px}
.plate.d{background:#0c0c0d}.plate.l{background:#f7f7f8}
</style>
<section>${tab("dark")}${tab("light")}</section>
<section>
  <div class="plate d"><img src="${png("icons/favicon-16.png")}" width="16" height="16"><img src="${png("icons/favicon-32.png")}" width="32" height="32"></div>
  <div class="plate l"><img src="${png("icons/favicon-16.png")}" width="16" height="16"><img src="${png("icons/favicon-32.png")}" width="32" height="32"></div>
  ${zoom("icons/favicon-16.png", 16)}${zoom("icons/favicon-32.png", 32)}
</section>
<section>
  ${plain("icons/apple-touch-icon.png", 180)}${plain("icons/icon-192.png", 192)}
  ${plain("icons/icon-512.png", 512, 192)}${plain("icons/icon-maskable-512.png", 512, 192)}
</section>`;
};

Fs.writeFileSync(Path.join(publicDir, "favicon.svg"), small);
console.log("✓ public/favicon.svg");

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const icon of icons) await draw(page, icon);
  await page.setViewportSize({ width: 960, height: 600 });
  await page.setContent(sheetHtml());
  await page.screenshot({ path: sheetFile, fullPage: true });
  console.log("✓ docs/screenshots/brand-icons.png");
} finally {
  await browser.close();
}
