// `pnpm --filter @stash/extension icons`: draws the toolbar and add-on icons from the two logo
// SVGs in `assets/` in headless Chromium, so no icon is exported by hand. 16 and 32 px come from
// the small mark (`stash-mark-sm.svg`, made for those sizes), 48, 96 and 128 from the full one.
// It writes `public/icon/<size>.png`, which `wxt.config.ts` lists. The SVGs are copies of the web
// kit's (`packages/web/ui/src/logo/`); keep them in step by hand, like `assets/tokens.css`.
import * as Fs from "node:fs";
import * as Path from "node:path";
import { chromium } from "playwright";

const appDir = Path.resolve(import.meta.dirname, "..");
const outDir = Path.join(appDir, "public/icon");
const read = (name: string) => Fs.readFileSync(Path.join(appDir, "assets", name), "utf8");
const full = read("stash-mark.svg");
const small = read("stash-mark-sm.svg");

const icons = [
  { size: 16, svg: small },
  { size: 32, svg: small },
  { size: 48, svg: full },
  { size: 96, svg: full },
  { size: 128, svg: full },
] as const;

Fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const { size, svg } of icons) {
    await page.setViewportSize({ width: size, height: size });
    const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
    await page.setContent(
      `<!doctype html><style>html,body{margin:0;background:transparent}img{display:block}</style><img src="${src}" width="${size}" height="${size}">`,
    );
    await page.evaluate("document.images[0].decode()");
    const image = page.locator("img");
    await image.screenshot({ path: Path.join(outDir, `${size}.png`), omitBackground: true });
    console.log(`✓ public/icon/${size}.png`);
  }
} finally {
  await browser.close();
}
