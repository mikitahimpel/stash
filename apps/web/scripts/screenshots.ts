// `pnpm --filter @stash/web screenshots`: boots the api under `alchemy dev` (no credentials) on its
// own stage and ports, seeds synthetic data and a session through the dev-only `/_smoke/*` routes,
// runs the Vite dev server against it (proxying `/api`), and captures every page with headless
// Chromium in both themes at desktop and phone width into `docs/screenshots/`, seeded and as a
// first-run user with no data (`*-empty-*.png`). On the way it checks that no page scrolls sideways
// and that every button has an accessible name, and exits 1 if one does.
// `STASH_SCREENSHOTS_VIEWS=link-,ui` limits the run to the views whose name starts with one of the
// listed prefixes.
import { type ChildProcess, spawn } from "node:child_process";
import * as Crypto from "node:crypto";
import * as Fs from "node:fs";
import * as Http from "node:http";
import * as Os from "node:os";
import * as Path from "node:path";
import { type Browser, chromium, type Page } from "playwright";
import * as CheckClock from "./check-clock.ts";
import * as Fixtures from "./layout-fixtures.ts";
import * as PreviewImages from "./preview-images.ts";

const appDir = Path.resolve(import.meta.dirname, "..");
const repoRoot = Path.resolve(appDir, "../..");
const outDir = Path.join(repoRoot, "docs/screenshots");

const apiPort = Number(process.env["STASH_SCREENSHOTS_API_PORT"] ?? 8797);
const webPort = Number(process.env["STASH_SCREENSHOTS_WEB_PORT"] ?? 5179);
const apiUrl = `http://localhost:${apiPort}`;
const webUrl = `http://localhost:${webPort}`;

/** The invite link the screenshots open: synthetic, and only in the local dev database. */
// Per run: the api keeps the invite's hash, so a fixed token fails to seed on a second run.
const screenshotInvite = Crypto.randomBytes(32).toString("base64url");

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
  /** Shows the page as a first-run user sees it: the api answers with no data. */
  readonly empty?: boolean;
  /** A returning user: the browser already holds recent searches. */
  readonly recentSearches?: boolean;
  /**
   * The page's links and devices come from the audit's fixtures (`layout-fixtures.ts`), answered
   * in the browser on the checks' clock (`check-clock.ts`), so the page is the same at any hour;
   * also, the seed has no YouTube link, and its ids are its own.
   */
  readonly fixtures?: boolean;
  /** With `fixtures`: the open tabs come from the fixtures too, as this scene. */
  readonly tabs?: Fixtures.TabsScene;
  /**
   * Captured at the window's own height, not the page's: the page's media are sized by the
   * window (`70vh`), so a taller window would show a layout no screen has.
   */
  readonly window?: boolean;
  /** Captures only this element (the app header) instead of the page. */
  readonly clip?: string;
}

const views: ReadonlyArray<View> = [
  {
    // On the audit's fixtures, like every page that groups links by day: the seeded api dates its
    // links by its own clock, so its Inbox would show other day groups in the early morning (#188).
    name: "inbox",
    path: "/links",
    signedIn: true,
    fixtures: true,
    prepare: async (page) => {
      await page.locator("[data-slot=link-day]").first().waitFor();
      // The keyboard's row, with its action bar.
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("ArrowDown");
      await page.locator("[data-slot=media-row-actions]").waitFor();
    },
  },
  // Open now (#181), with its tabs answered from the audit's fixtures so that some are saved
  // links: the seeded account (three devices, a stale group, saved tabs), one browser with a long
  // list, two devices, a row with its actions out, and tabs picked for a bulk save.
  {
    name: "open-now",
    path: "/open-now",
    signedIn: true,
    fixtures: true,
    tabs: "default",
    prepare: (page) => page.locator("[data-section]").first().waitFor(),
  },
  {
    name: "open-now-many",
    path: "/open-now",
    signedIn: true,
    fixtures: true,
    tabs: "many",
    prepare: (page) => page.locator("[data-section]").first().waitFor(),
  },
  {
    name: "open-now-two-devices",
    path: "/open-now",
    signedIn: true,
    fixtures: true,
    tabs: "two",
    prepare: (page) => page.locator("[data-section]").first().waitFor(),
  },
  {
    name: "open-now-selected",
    path: "/open-now",
    signedIn: true,
    fixtures: true,
    tabs: "default",
    prepare: async (page) => {
      await page
        .locator("[data-tab]")
        .nth(1)
        .click({ position: { x: 4, y: 4 } });
      await page.locator("[data-state=selected] [data-action=copy]").waitFor();
    },
  },
  {
    name: "open-now-picking",
    path: "/open-now",
    signedIn: true,
    fixtures: true,
    tabs: "default",
    prepare: async (page) => {
      await page.locator("[data-action=pick]").click();
      await page.locator("[data-tab] [role=checkbox]").nth(1).click();
      await page.locator("[data-tab] [role=checkbox]").nth(3).click();
      await page.locator("[data-action=save-picked]").waitFor();
    },
  },
  // The app header alone: the compact search field at rest, and grown while it has the focus
  // (the nav and the account button stay where they are). On phones it is a full-width line.
  {
    name: "header",
    path: "/links",
    signedIn: true,
    clip: "[data-slot=app-bar]",
    prepare: (page) => page.locator("[data-slot=link-day]").first().waitFor(),
  },
  {
    name: "header-focused",
    path: "/links",
    signedIn: true,
    clip: "[data-slot=app-bar]",
    prepare: async (page) => {
      await page.locator("[data-slot=link-day]").first().waitFor();
      await page.getByRole("searchbox", { name: "Search links" }).focus();
    },
  },
  {
    // Searching: the header's field filters the Inbox in place.
    name: "inbox-search",
    path: "/links",
    signedIn: true,
    prepare: async (page) => {
      await page.getByRole("searchbox", { name: "Search links" }).fill("economics");
      await page.locator("[data-slot=search-results] [data-slot=link-row]").first().waitFor();
    },
  },
  {
    // The focused, empty field of a returning user: recent searches hang under it.
    name: "inbox-search-recent",
    path: "/links",
    signedIn: true,
    fixtures: true,
    recentSearches: true,
    prepare: async (page) => {
      await page.locator("[data-slot=link-day]").first().waitFor();
      await page.getByRole("searchbox", { name: "Search links" }).focus();
      await page.locator("[data-recent]").first().waitFor();
    },
  },
  {
    name: "save",
    path: "/save?url=https://example.com/economics/rates",
    signedIn: true,
    prepare: (page) => page.locator("[data-slot=saved-link]").waitFor(),
  },
  // A link's page: a YouTube video (thumbnail and play button), an article with an og:image, and
  // a link with no image (the generated cover). The links come from the audit's fixtures.
  ...(
    [
      ["link-youtube", Fixtures.youtubeLinkId],
      ["link-article", Fixtures.articleLinkId],
      ["link-cover", Fixtures.coverLinkId],
      // Not 16:9 (#176): a YouTube Short, and an article whose og:image is a portrait.
      ["link-short", Fixtures.shapeLinkIds.short],
      ["link-tall-image", Fixtures.shapeLinkIds.tall],
    ] as const
  ).map(([name, id]) => ({
    name,
    path: `/links/${id}`,
    signedIn: true,
    fixtures: true,
    window: true,
    prepare: async (page: Page) => {
      await page.locator("[data-slot=link-details] h1").waitFor();
      // The preview is in (and its shape measured) before the page is measured or captured.
      await page.waitForFunction(
        "[...document.querySelectorAll('[data-slot=link-details] img')].every((img) => img.complete)",
      );
    },
  })),
  // A post on X as a card (#170): words only, one photo, four photos, a video, a reply that
  // quotes a post, and a post that could not be read.
  ...(Object.entries(Fixtures.postLinkIds) as ReadonlyArray<[string, string]>).map(
    ([kind, id]) => ({
      name: `post-${kind}`,
      path: `/links/${id}`,
      signedIn: true,
      fixtures: true,
      window: true,
      prepare: async (page: Page) => {
        await page.locator("[data-slot=post], [data-slot=post-unavailable]").waitFor();
        // Every picture of the post is in before the page is measured or captured.
        await page.waitForFunction(
          "[...document.querySelectorAll('[data-slot=link-details] img')].every((img) => img.complete)",
        );
      },
    }),
  ),
  {
    // The Inbox with posts among the other links: the same row height, the author's line first.
    name: "inbox-posts",
    path: "/links",
    signedIn: true,
    fixtures: true,
    prepare: async (page) => {
      await page.locator("[data-slot=link-row][data-post]").first().waitFor();
      // The previews of other shapes are in: letterboxed, each in the same 16:9 box (#176).
      await page.locator("[data-slot=link-row] [data-fit=contain]").first().waitFor();
    },
  },
  {
    // A photo of a post, opened large.
    name: "post-lightbox",
    path: `/links/${Fixtures.postLinkIds.photos}`,
    signedIn: true,
    fixtures: true,
    prepare: async (page) => {
      await page.locator("[data-slot=post-photo]").nth(1).click();
      await page.locator("[data-slot=post-lightbox-photo]").waitFor();
    },
  },
  {
    name: "settings",
    path: "/settings",
    signedIn: true,
    prepare: async (page) => {
      await page.locator("[data-source]").first().waitFor();
      await page.locator("[data-test=device]").first().waitFor();
    },
  },
  {
    name: "settings-iphone",
    path: "/settings?guide=iphone",
    signedIn: true,
    prepare: async (page) => {
      // The guide as it looks once the device exists: the Shortcut URL prefilled, waiting.
      await page.locator("[data-guide=iphone] [data-action=create]").click();
      await page.locator("[data-test=waiting]").waitFor();
    },
  },
  {
    name: "settings-extension",
    path: "/settings?guide=extension",
    signedIn: true,
    prepare: (page) => page.locator("[data-guide=extension]").waitFor(),
  },
  {
    name: "settings-mac",
    path: "/settings?guide=mac",
    signedIn: true,
    prepare: async (page) => {
      await page.locator("[data-guide=mac] [data-action=create]").click();
      await page.locator("[data-test=waiting]").waitFor();
    },
  },
  {
    name: "settings-claude",
    path: "/settings?guide=claude",
    signedIn: true,
    prepare: (page) => page.locator("[data-guide=claude] [data-test=waiting]").waitFor(),
  },
  {
    name: "connect-extension-approve",
    path: `/connect/extension?code=${"c".repeat(43)}`,
    signedIn: true,
    prepare: (page) => page.locator("[data-action=approve]").waitFor(),
  },
  {
    name: "inbox-empty",
    path: "/links",
    signedIn: true,
    empty: true,
    prepare: (page) => page.locator("[data-slot=start-saving]").waitFor(),
  },
  {
    name: "open-now-empty",
    path: "/open-now",
    signedIn: true,
    empty: true,
    prepare: (page) => page.locator("[data-slot=start-saving]").waitFor(),
  },
  {
    name: "settings-empty",
    path: "/settings",
    signedIn: true,
    empty: true,
    prepare: async (page) => {
      await page.locator("[data-source]").first().waitFor();
      await page.locator("[data-test=no-devices]").waitFor();
    },
  },
  // Signing in (#178): passkey first, then Google (on: the run binds a synthetic client) and
  // GitHub; the invite link's page; and Settings → Security with passkeys and linked accounts.
  {
    name: "login",
    path: "/login",
    signedIn: false,
    prepare: (page) => page.getByRole("button", { name: "Continue with Google" }).waitFor(),
  },
  {
    name: "invite",
    path: `/invite/${screenshotInvite}`,
    signedIn: false,
    prepare: (page) => page.locator("[data-test=invite][data-state=open]").waitFor(),
  },
  {
    name: "settings-security",
    path: "/settings#security",
    signedIn: true,
    clip: "[data-test=security]",
    prepare: (page) => page.locator("[data-test=security] [data-test=passkey]").first().waitFor(),
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

// What the api answers a first-run user. The seed lives in one local D1 shared by every view, so
// the empty views get these answers in the browser instead.
const emptyAnswers: Readonly<Record<string, unknown>> = {
  "/api/links": { items: [], nextCursor: null },
  "/api/tabs": { devices: [] },
  "/api/devices": [],
  "/api/devices/activity": [],
  "/api/tokens": [],
};

const answerEmpty = (page: Page) =>
  page.route("**/api/**", (route) => {
    const answer = emptyAnswers[new URL(route.request().url()).pathname];
    return route.request().method() === "GET" && answer !== undefined
      ? route.fulfill({ json: answer })
      : route.fallback();
  });

const answerFixtures = (page: Page, tabs: Fixtures.TabsScene | undefined) => {
  const fixtures = Fixtures.seeded(CheckClock.now(), tabs === undefined ? {} : { tabs });
  return page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api/, "");
    const answer =
      route.request().method() === "GET" &&
      (path.startsWith("/links") || path === "/devices" || (path === "/tabs" && tabs !== undefined))
        ? fixtures.answer("GET", url)
        : undefined;
    return answer === undefined ? route.fallback() : route.fulfill({ json: answer });
  });
};

const capture = async (browser: Browser, sessionToken: string): Promise<Array<string>> => {
  const problems: Array<string> = [];
  for (const theme of themes) {
    for (const viewport of viewports) {
      const options = {
        viewport: { width: viewport.width, height: viewport.height },
        colorScheme: theme,
        deviceScaleFactor: 1,
        reducedMotion: "reduce",
      } as const;
      // The pages on the audit's fixtures (or none) run on the checks' clock, so their day groups
      // and ages are the same at every hour (#188). The rest show the seeded api, which dates its
      // data by its own clock, so they keep the wall clock; none of them groups links by day.
      const synthetic = await CheckClock.newContext(browser, options);
      const seeded = await browser.newContext(options);
      for (const view of views.filter(wanted)) {
        const onChecksClock = view.fixtures === true || view.empty === true;
        const context = onChecksClock ? synthetic : seeded;
        await context.clearCookies();
        if (view.signedIn) {
          await context.addCookies([
            { name: "stash_session", value: sessionToken, domain: "localhost", path: "/" },
          ]);
        }
        const page = await context.newPage();
        // The seeded links' preview images are drawn here; nothing is fetched from example.com.
        await page.route(`${PreviewImages.origin}**`, (route) =>
          route.fulfill({
            contentType: "image/svg+xml",
            body: PreviewImages.forUrl(route.request().url()),
          }),
        );
        // So are the favicons of the seeded tabs' sites (see `PreviewImages.faviconShim`).
        await page.addInitScript(PreviewImages.faviconShim);
        await page.route(PreviewImages.isFavicon, (route) =>
          route.fulfill({
            contentType: "image/svg+xml",
            body: PreviewImages.favicon(route.request().url()),
          }),
        );
        if (view.empty) await answerEmpty(page);
        if (view.fixtures) await answerFixtures(page, view.tabs);
        // Recent searches live in the browser: a returning user has some, everyone else none.
        const [key, value] = Fixtures.recentSearches(CheckClock.now());
        // As a string, so the script itself never names the DOM globals.
        await page.addInitScript(
          view.recentSearches
            ? `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(value)})`
            : `localStorage.removeItem(${JSON.stringify(key)})`,
        );
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
        const height = view.window
          ? viewport.height
          : Math.min(
              (await page.evaluate(scrollHeight)) as number,
              view.maxHeight ?? defaultMaxHeight,
            );
        await page.setViewportSize({ width: viewport.width, height });
        if (view.clip === undefined) await page.screenshot({ path: Path.join(outDir, file) });
        else await page.locator(view.clip).screenshot({ path: Path.join(outDir, file) });
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        console.log(`✓ ${file}`);
        await page.close();
      }
      await synthetic.close();
      await seeded.close();
    }
  }
  return problems;
};

// `STASH_SCREENSHOTS_VIEWS=link-,ui` captures only the views whose name starts with one of these.
const only = (process.env["STASH_SCREENSHOTS_VIEWS"] ?? "")
  .split(",")
  .filter((name) => name !== "");
const wanted = (view: View) =>
  only.length === 0 || only.some((prefix) => view.name.startsWith(prefix));

const main = async () => {
  const alchemyEnv: Record<string, string | undefined> = {
    STASH_API_PORT: String(apiPort),
    STASH_MCP_PORT: String(apiPort + 1),
    STASH_WEB_PORT: String(apiPort + 2),
    STASH_WEB_ORIGIN: webUrl,
    // A synthetic Google client, so the login page shows its button. Nobody signs in with it here.
    GOOGLE_CLIENT_ID: "synthetic-google-client-id",
    GOOGLE_CLIENT_SECRET: "synthetic-google-client-secret",
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

  const inviteHash = Crypto.createHash("sha256").update(screenshotInvite).digest("hex");
  if ((await call("POST", `${apiUrl}/_smoke/invite`, { hash: inviteHash })) !== 201) {
    throw new Error("seeding the invite failed");
  }
  if ((await call("POST", `${apiUrl}/_smoke/sign-in-methods`)) !== 201) {
    throw new Error("seeding the sign-in methods failed");
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
