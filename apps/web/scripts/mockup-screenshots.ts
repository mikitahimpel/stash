// `pnpm --filter @stash/web screenshots:mockups`: runs the Vite dev server (the mockups are
// dev-only routes on made-up data, so no api and no session), and captures each mockup of #148
// with headless Chromium in both themes at desktop and phone width into
// `docs/screenshots/mockups/`. It exits 1 if a page scrolls sideways.
import { type ChildProcess, spawn } from "node:child_process";
import * as Fs from "node:fs";
import * as Path from "node:path";
import { chromium, type Page } from "playwright";
import * as PreviewServer from "./preview-server.ts";

const appDir = Path.resolve(import.meta.dirname, "..");
const outDir = Path.resolve(appDir, "../../docs/screenshots/mockups");
const port = Number(process.env["STASH_MOCKUPS_WEB_PORT"] ?? 5181);
const baseUrl = `http://localhost:${port}`;

const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
] as const;
const themes = ["dark", "light"] as const;

interface View {
  readonly name: string;
  readonly path: string;
  /** Brings the page into the state worth showing, once it has rendered. */
  readonly prepare: (page: Page, phone: boolean) => Promise<void>;
}

const views: ReadonlyArray<View> = [
  {
    name: "inbox",
    path: "/_mockups/inbox",
    // The pointer rests on the second row, to show the hover background against the content edge.
    prepare: async (page, phone) => {
      if (phone) return;
      await page.locator("[data-slot=media-row]").nth(1).hover();
      // The background fades in.
      await page.waitForTimeout(400);
    },
  },
  { name: "search", path: "/_mockups/search", prepare: async () => {} },
  { name: "search-empty", path: "/_mockups/search-empty", prepare: async () => {} },
];

const startVite = async (): Promise<ChildProcess | undefined> => {
  if ((await PreviewServer.status(`${baseUrl}/_mockups/inbox`)) === 200) return undefined;
  const child = spawn(
    "node_modules/.bin/vite",
    ["--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    { cwd: appDir, stdio: ["ignore", "pipe", "pipe"], detached: true },
  );
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString()));
  const deadline = Date.now() + 60_000;
  while ((await PreviewServer.status(`${baseUrl}/_mockups/inbox`)) !== 200) {
    if (Date.now() > deadline || child.exitCode !== null) {
      throw new Error(`vite didn't start\n${output}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return child;
};

const main = async (): Promise<Array<string>> => {
  const problems: Array<string> = [];
  Fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const theme of themes) {
      for (const viewport of viewports) {
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          colorScheme: theme,
          deviceScaleFactor: 1,
          reducedMotion: "reduce",
        });
        for (const view of views) {
          const page = await context.newPage();
          await page.goto(`${baseUrl}${view.path}`);
          await page.locator("[data-slot=media-row]").first().waitFor();
          await page.waitForLoadState("networkidle");
          await page.evaluate("document.fonts.ready");
          const file = `${view.name}-${theme}-${viewport.name}.png`;

          const width = (await page.evaluate("document.documentElement.scrollWidth")) as number;
          if (width > viewport.width) {
            problems.push(`${file}: scrollWidth ${width} > ${viewport.width}`);
          }
          // The viewport grows to the page, so the phone's bottom nav sits at the bottom.
          const height = (await page.evaluate("document.documentElement.scrollHeight")) as number;
          await page.setViewportSize({
            width: viewport.width,
            height: Math.max(height, viewport.height),
          });
          await view.prepare(page, viewport.name === "phone");
          await page.screenshot({ path: Path.join(outDir, file) });
          console.log(`✓ ${file}`);
          await page.close();
        }
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  return problems;
};

const vite = await startVite();
try {
  const problems = await main();
  if (problems.length > 0) {
    console.error(problems.join("\n"));
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  if (vite?.pid !== undefined) process.kill(-vite.pid, "SIGTERM");
}
