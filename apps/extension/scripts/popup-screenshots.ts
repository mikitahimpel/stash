// `pnpm --filter @stash/extension screenshots`: renders the toolbar popup (the real
// `popup-page.vue` over the made-up states in `preview/popup/`, so no browser extension, no api
// and no session) and captures it with headless Chromium in both themes into `docs/screenshots/`
// as `extension-popup-<state>-<theme>.png`. It exits 1 if the popup or its recent list scrolls
// sideways, or the popup is taller than Firefox's 600px.
import * as Fs from "node:fs";
import * as Path from "node:path";
import vue from "@vitejs/plugin-vue";
import { chromium } from "playwright";
import { createServer } from "vite";

const appDir = Path.resolve(import.meta.dirname, "..");
const outDir = Path.resolve(appDir, "../../docs/screenshots");
const port = Number(process.env["STASH_POPUP_PREVIEW_PORT"] ?? 5191);

const states = ["not-paired", "paired", "saved"] as const;
const themes = ["dark", "light"] as const;
/** The popup sets its own width; the browser gives it the height it asks for, up to 600. */
const width = 380;

const server = await createServer({
  configFile: false,
  root: Path.join(appDir, "preview/popup"),
  plugins: [vue()],
  logLevel: "warn",
  server: { host: "127.0.0.1", port, strictPort: true },
});
await server.listen();

const problems: Array<string> = [];
const browser = await chromium.launch();
try {
  Fs.mkdirSync(outDir, { recursive: true });
  for (const theme of themes) {
    const context = await browser.newContext({
      viewport: { width, height: 600 },
      colorScheme: theme,
      deviceScaleFactor: 2,
      reducedMotion: "reduce",
    });
    for (const state of states) {
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:${port}/#${state}`);
      await page.locator(".status").waitFor();
      await page.evaluate("document.fonts.ready");
      const file = `extension-popup-${state}-${theme}.png`;
      const scrollWidth = (await page.evaluate("document.documentElement.scrollWidth")) as number;
      if (scrollWidth > width) problems.push(`${file}: scrollWidth ${scrollWidth} > ${width}`);
      // The browser sizes a popup to its content, so the picture is the popup itself.
      const popup = page.locator(".popup");
      const height = (await popup.boundingBox())?.height ?? 0;
      if (height > 600) problems.push(`${file}: ${height}px tall, a popup is 600 at most`);
      // Past 600px the recent list scrolls inside the popup: up and down only.
      const list = (await page.evaluate(
        `(() => { const it = document.querySelector(".recent"); return it && { sw: it.scrollWidth, cw: it.clientWidth, sh: it.scrollHeight, ch: it.clientHeight }; })()`,
      )) as { sw: number; cw: number; sh: number; ch: number } | null;
      if (list !== null && list.sw > list.cw)
        problems.push(`${file}: the recent list scrolls sideways (${list.sw} > ${list.cw})`);
      const scrolls =
        list !== null && list.sh > list.ch ? `, recent list scrolls ${list.sh - list.ch}px` : "";
      await popup.screenshot({ path: Path.join(outDir, file) });
      console.log(`✓ ${file} (${Math.round(height)}px${scrolls})`);
      await page.close();
    }
    await context.close();
  }
} finally {
  await browser.close();
  await server.close();
}
if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exitCode = 1;
}
