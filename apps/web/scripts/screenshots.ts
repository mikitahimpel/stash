// `pnpm --filter @stash/web screenshots`: boots the api under `alchemy dev` (no credentials) on its
// own stage and ports, seeds synthetic data and a session through the dev-only `/_smoke/*` routes,
// runs the Vite dev server against it (proxying `/api`), and captures every page with headless Chromium in both
// themes at desktop and phone width into `docs/screenshots/`. On the way it checks that no page
// scrolls sideways and that every button has an accessible name, and exits 1 if one does.
import { type ChildProcess, spawn } from "node:child_process";
import * as Crypto from "node:crypto";
import * as Fs from "node:fs";
import * as Http from "node:http";
import * as Os from "node:os";
import * as Path from "node:path";
import { type Browser, chromium, type Page } from "playwright";

const appDir = Path.resolve(import.meta.dirname, "..");
const repoRoot = Path.resolve(appDir, "../..");
const outDir = Path.join(repoRoot, "docs/screenshots");

const apiPort = Number(process.env["STASH_SCREENSHOTS_API_PORT"] ?? 8797);
const webPort = Number(process.env["STASH_SCREENSHOTS_WEB_PORT"] ?? 5179);
const apiUrl = `http://localhost:${apiPort}`;
const webUrl = `http://localhost:${webPort}`;

const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
] as const;
const themes = ["dark", "light"] as const;

interface View {
  readonly name: string;
  readonly path: string;
  readonly signedIn: boolean;
  /** Brings the page into the state worth capturing, once it has loaded. */
  readonly prepare: (page: Page) => Promise<void>;
  /** Where a long page is cut (px). The gallery is shown whole. */
  readonly maxHeight?: number;
}

const views: ReadonlyArray<View> = [
  {
    name: "inbox",
    path: "/links",
    signedIn: true,
    prepare: (page) => page.locator("[data-slot=link-day]").first().waitFor(),
  },
  {
    name: "open-now",
    path: "/open-now",
    signedIn: true,
    prepare: (page) => page.locator("[data-section]").first().waitFor(),
  },
  {
    name: "search",
    path: "/search",
    signedIn: true,
    prepare: async (page) => {
      await page.getByRole("searchbox", { name: "Search links" }).fill("economics");
      await page.locator("[data-hit]").first().waitFor();
    },
  },
  {
    name: "settings",
    path: "/settings",
    signedIn: true,
    prepare: (page) => page.locator("[data-test=device]").first().waitFor(),
  },
  {
    name: "login",
    path: "/login",
    signedIn: false,
    prepare: (page) => page.getByRole("button", { name: /sign in/i }).waitFor(),
  },
  {
    name: "ui",
    path: "/_ui",
    signedIn: false,
    maxHeight: Number.POSITIVE_INFINITY,
    prepare: (page) => page.locator("h1").first().waitFor(),
  },
];

// node:http keeps the script off the `fetch` global, which oxlint reserves for platform packages.
const call = (method: string, url: string, body?: unknown): Promise<number> =>
  new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const headers = payload === undefined ? {} : { "content-type": "application/json" };
    const req = Http.request(url, { method, headers }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode ?? 0));
    });
    req.on("error", reject);
    req.end(payload);
  });

const children: Array<ChildProcess> = [];
const start = (name: string, command: string, args: Array<string>, cwd: string, env = {}) => {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString()));
  children.push(child);
  return { child, output: () => `${name}:\n${output}` };
};

// SIGINT lets alchemy stop workerd and its sidecar; the process group goes down with it.
const stopAll = async () => {
  await Promise.all(
    children.map(async (child) => {
      if (child.pid === undefined || child.exitCode !== null) return;
      const exited = new Promise((resolve) => child.once("exit", resolve));
      process.kill(-child.pid, "SIGINT");
      const timer = setTimeout(() => process.kill(-child.pid!, "SIGKILL"), 10_000);
      await exited;
      clearTimeout(timer);
    }),
  );
};

const waitFor = async (what: string, url: string, logs: () => string, timeoutMs = 120_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await call("GET", url).catch(() => 0)) === 200) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`timed out waiting for ${what}\n${logs()}`);
};

// Run in the page, as a string so the script itself never names the DOM globals.
const scrollWidth = "document.documentElement.scrollWidth";
const scrollHeight = "document.documentElement.scrollHeight";
const defaultMaxHeight = 2000;
// Buttons (and links styled as buttons) whose accessible name would be empty: no text, no
// aria-label or aria-labelledby, no title.
const unnamedButtons = `[...document.querySelectorAll('button, [role=button], a[href]')]
  .filter((el) => el.getClientRects().length > 0)
  .filter((el) => !(el.getAttribute('aria-label') || '').trim()
    && !(el.getAttribute('aria-labelledby') || '').trim()
    && !(el.textContent || '').trim()
    && !(el.getAttribute('title') || '').trim())
  .map((el) => el.outerHTML.slice(0, 160))`;

const capture = async (browser: Browser, sessionToken: string): Promise<Array<string>> => {
  const problems: Array<string> = [];
  for (const theme of themes) {
    for (const viewport of viewports) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        colorScheme: theme,
        deviceScaleFactor: 1,
        reducedMotion: "reduce",
      });
      for (const view of views) {
        await context.clearCookies();
        if (view.signedIn) {
          await context.addCookies([
            { name: "stash_session", value: sessionToken, domain: "localhost", path: "/" },
          ]);
        }
        const page = await context.newPage();
        await page.goto(`${webUrl}${view.path}`);
        await view.prepare(page).catch(async (error: unknown) => {
          // Keep the page as it was, to see why it never got ready.
          const failed = Path.join(Os.tmpdir(), `stash-${view.name}-failed.png`);
          await page.screenshot({ path: failed, fullPage: true });
          throw new Error(`${view.path} never got ready (see ${failed})`, { cause: error });
        });
        // Fonts and the last revalidations settle before the picture is taken.
        await page.waitForLoadState("networkidle");
        await page.evaluate("document.fonts.ready");
        const file = `${view.name}-${theme}-${viewport.name}.png`;

        // Checked at the real viewport size.
        const width = (await page.evaluate(scrollWidth)) as number;
        if (width > viewport.width) {
          problems.push(`${file}: scrollWidth ${width} > ${viewport.width}`);
        }
        const unnamed = (await page.evaluate(unnamedButtons)) as Array<string>;
        for (const html of unnamed) problems.push(`${file}: control without a name: ${html}`);

        // The viewport grows to the page's height (long pages are cut: the top shows the layout,
        // and the rows below repeat it), so fixed parts such as the phone's bottom nav sit at the
        // bottom of the picture, as on a screen, instead of being stamped mid-page.
        const height = Math.min(
          (await page.evaluate(scrollHeight)) as number,
          view.maxHeight ?? defaultMaxHeight,
        );
        await page.setViewportSize({ width: viewport.width, height });
        await page.screenshot({ path: Path.join(outDir, file) });
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        console.log(`✓ ${file}`);
        await page.close();
      }
      await context.close();
    }
  }
  return problems;
};

const main = async () => {
  const alchemyEnv: Record<string, string | undefined> = {
    STASH_API_PORT: String(apiPort),
    STASH_MCP_PORT: String(apiPort + 1),
    STASH_WEB_PORT: String(apiPort + 2),
    STASH_WEB_ORIGIN: webUrl,
  };
  // Never deploy anything: the stack runs locally without Cloudflare credentials.
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("CLOUDFLARE_")) alchemyEnv[key] = undefined;
  }
  // Servers already up on these ports (say, from an earlier run kept for iterating) are reused.
  const up = (url: string) =>
    call("GET", url).then(
      (status) => status === 200,
      () => false,
    );
  if (!(await up(`${apiUrl}/health`))) {
    const api = start(
      "alchemy dev",
      "node_modules/.bin/alchemy",
      ["dev", "--stage", "screenshots"],
      repoRoot,
      alchemyEnv,
    );
    await waitFor("the api", `${apiUrl}/health`, api.output);
  }
  if (!(await up(`${webUrl}/login`))) {
    const web = start(
      "vite",
      "node_modules/.bin/vite",
      ["--host", "0.0.0.0", "--port", String(webPort), "--strictPort"],
      appDir,
      { STASH_DEV_API_URL: apiUrl },
    );
    await waitFor("the web dev server", `${webUrl}/login`, web.output);
  }

  if ((await call("POST", `${apiUrl}/_smoke/seed`)) !== 201) throw new Error("seeding failed");
  // A synthetic session token, generated per run. Only its hash goes to D1.
  const sessionToken = Crypto.randomBytes(32).toString("base64url");
  const hash = Crypto.createHash("sha256").update(sessionToken).digest("hex");
  if ((await call("POST", `${apiUrl}/_smoke/session`, { hash })) !== 201) {
    throw new Error("seeding the session failed");
  }

  Fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  try {
    const problems = await capture(browser, sessionToken);
    if (problems.length > 0) {
      console.error(problems.join("\n"));
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
  }
};

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await stopAll();
}
