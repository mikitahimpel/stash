// `pnpm --filter @stash/extension screenshots:options`: renders the options page (the real
// `options-page.vue` over the made-up states in `preview/options/`, so no browser extension, no
// api and no session) and captures it with headless Chromium in both themes into
// `docs/screenshots/` as `extension-options-<state>-<theme>.png`. It exits 1 if the page scrolls
// sideways, at the desktop width or at a narrow one.
import * as Fs from "node:fs";
import * as Path from "node:path";
import vue from "@vitejs/plugin-vue";
import { chromium } from "playwright";
import { createServer } from "vite";

const appDir = Path.resolve(import.meta.dirname, "..");
const outDir = Path.resolve(appDir, "../../docs/screenshots");
const port = Number(process.env["STASH_OPTIONS_PREVIEW_PORT"] ?? 5192);

const states = ["unpaired", "pairing", "paired", "error"] as const;
const themes = ["dark", "light"] as const;
const viewport = { width: 880, height: 560 };
const narrow = 360;

const server = await createServer({
  configFile: false,
  root: Path.join(appDir, "preview/options"),
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
      viewport,
      colorScheme: theme,
      deviceScaleFactor: 2,
      reducedMotion: "reduce",
    });
    for (const state of states) {
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:${port}/#${state}`);
      await page.locator(".card h2").first().waitFor();
      // The pairing state is the unpaired page after its one button was clicked.
      if (state === "pairing") {
        await page.locator("button[name=connect]").click();
        await page.locator(".code").waitFor();
      }
      await page.evaluate("document.fonts.ready");
      const file = `extension-options-${state}-${theme}.png`;
      await page.screenshot({ path: Path.join(outDir, file) });
      for (const width of [viewport.width, narrow]) {
        await page.setViewportSize({ width, height: viewport.height });
        const scrollWidth = (await page.evaluate("document.documentElement.scrollWidth")) as number;
        if (scrollWidth > width) problems.push(`${file}: scrollWidth ${scrollWidth} > ${width}`);
      }
      console.log(`✓ ${file}`);
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
