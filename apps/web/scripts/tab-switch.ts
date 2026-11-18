// `pnpm --filter @stash/web check:tab-switch` (after a build; CI job `layout-audit` runs it): the
// speed of the header tabs on the built app. It serves the build with `vite preview`, answers the
// api from the layout fixtures after a delay (so a page that waits for the network shows it), and
// clicks through Inbox, Open now and Settings in headless Chromium, one page at a time.
//
// It fails when a switch to a tab that was already open
// - takes more than `budgetMillis` from the click to the frame that shows the tab's rows,
// - shows a skeleton or an empty page area, then or while the tab refreshes behind,
// - doesn't ask the api for the tab's own data again (the cached rows must be revalidated; the
//   auth guard's `/auth/me` doesn't count),
// - or loses the tab's scroll position.
// And when the first visit of a tab doesn't show its layout (the page title) and its rows within
// the budget, which needs the tab's code and first data to be there before the click (the app
// loads both while it is idle), or when a tab the pointer rested on
// doesn't open with its rows, which needs the hover to have loaded its data.
//
// It also saves a link "on another device" (the fixture gains one) while another tab is open, and
// fails when the Inbox doesn't show it on the way back.
//
// `STASH_SWITCH_CPU` (a slowdown factor, default 1), `STASH_SWITCH_API_DELAY` (ms, default 300)
// and `STASH_SWITCH_NETWORK=slow` (the build's files over a throttled network) make it a
// measurement: with any of them set it only prints the numbers. `STASH_SWITCH_PROFILE=<dir>`
// writes a `.cpuprofile` per switch there.
import * as Fs from "node:fs";
import * as Path from "node:path";
import { type Browser, chromium, type CDPSession, type Page } from "playwright";
import * as Fixtures from "./layout-fixtures.ts";
import * as PreviewImages from "./preview-images.ts";
import * as PreviewServer from "./preview-server.ts";
import { arm, read, type Switch } from "./tab-switch-probe.ts";

const port = Number(process.env["STASH_AUDIT_PORT"] ?? 4179);
const baseUrl = `http://localhost:${port}`;

/** From the click to the painted page, in ms. */
export const budgetMillis = 100;

const cpu = Number(process.env["STASH_SWITCH_CPU"] ?? 1);
const apiDelay = Number(process.env["STASH_SWITCH_API_DELAY"] ?? 300);
const slowNetwork = process.env["STASH_SWITCH_NETWORK"] === "slow";
const profileDir = process.env["STASH_SWITCH_PROFILE"];
/** With the machine slowed down the numbers are a measurement, not a check. */
const measuring = cpu !== 1 || slowNetwork || process.env["STASH_SWITCH_API_DELAY"] !== undefined;

interface Tab {
  readonly label: string;
  /** The page title: the tab's layout is on screen. */
  readonly title: string;
  /** The tab's rows: its data is on screen. */
  readonly rows: string;
  /** The api path of the tab's own data: a visit must ask for it again. */
  readonly data: string;
}

const tabs = {
  inbox: {
    label: "Inbox",
    title: "Inbox",
    rows: "[data-slot=link-day] [data-slot=link-row]",
    data: "/api/links",
  },
  openNow: {
    label: "Open now",
    title: "Open now",
    rows: "[data-section] [data-tab]",
    data: "/api/tabs",
  },
  settings: {
    label: "Settings",
    title: "Settings",
    rows: "[data-test=device]",
    data: "/api/devices",
  },
} as const satisfies Record<string, Tab>;

/** A little over `ApiAtoms.prefetchFreshMillis`: after it, a visit asks the api again. */
const freshMillis = 1700;

const sleep = (millis: number) => new Promise((resolve) => setTimeout(resolve, millis));

/** The link the walk saves "on another device" between two visits of the Inbox. */
const elsewhere = { id: "seed-link-elsewhere", title: "Saved on another device" };

interface Api {
  /** The paths asked for since the last switch began. */
  readonly requests: Array<string>;
  /** Whether the link saved on another device is in the feed yet. */
  savedElsewhere: boolean;
}

const answer = async (page: Page, api: Api) => {
  const { requests } = api;
  const fixtures = Fixtures.seeded(Date.now());
  // The feed with one more link at its top, as if another device had just saved it.
  const withElsewhere = (body: unknown) => {
    const feed = body as { readonly items?: ReadonlyArray<Record<string, unknown>> };
    const first = feed.items?.[0];
    return first === undefined
      ? body
      : {
          ...feed,
          items: [
            { ...first, ...elsewhere, url: "https://example.com/elsewhere", status: "new" },
            ...feed.items!,
          ],
        };
  };
  await page.route(`${PreviewImages.origin}**`, (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: PreviewImages.forUrl(route.request().url()),
    }),
  );
  await page.addInitScript(PreviewImages.faviconShim);
  await page.route(PreviewImages.isFavicon, (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: PreviewImages.favicon(route.request().url()),
    }),
  );
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    requests.push(url.pathname);
    const answered = fixtures.answer(request.method(), url);
    const body =
      api.savedElsewhere && request.method() === "GET" && url.pathname === "/api/links"
        ? withElsewhere(answered)
        : answered;
    await sleep(apiDelay);
    return body === undefined
      ? route.fulfill({ status: 404, json: { _tag: "NotFound" } })
      : route.fulfill({ json: body });
  });
};

interface Row {
  readonly step: string;
  readonly what: string;
  readonly millis: number | null;
  readonly problems: ReadonlyArray<string>;
}

/** One walk through the tabs, in a fresh browser context. */
const walk = async (browser: Browser): Promise<ReadonlyArray<Row>> => {
  const rows: Array<Row> = [];
  {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      colorScheme: "light",
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    const errors: Array<string> = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const api: Api = { requests: [], savedElsewhere: false };
    const { requests } = api;
    await answer(page, api);
    const cdp: CDPSession = await context.newCDPSession(page);
    if (slowNetwork) {
      // "Fast 3G": 150 ms of latency, 1.6 Mbit/s down.
      await cdp.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: 150,
        downloadThroughput: (1.6 * 1024 * 1024) / 8,
        uploadThroughput: (750 * 1024) / 8,
      });
    }

    // The tabs' code and first data are fetched once the app is idle.
    const idleLoad = page.waitForRequest(
      (request) => new URL(request.url()).pathname === "/api/tabs",
    );
    await page.goto(`${baseUrl}/links`);
    await page.locator(tabs.inbox.rows).first().waitFor();
    await idleLoad;
    await sleep(apiDelay + 250);
    await page.waitForLoadState("networkidle");
    if (cpu !== 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });

    /** Clicks the tab and times the click to the first frames with its title and with its rows. */
    const go = async (step: string, tab: Tab): Promise<Switch> => {
      const body = page.locator("body");
      await body.evaluate(arm, { title: tab.title, rows: tab.rows });
      requests.length = 0;
      if (profileDir !== undefined) {
        await cdp.send("Profiler.enable");
        await cdp.send("Profiler.start");
      }
      await page.getByRole("navigation", { name: "Main" }).getByText(tab.label).click();
      await page.waitForFunction(
        "window.__tabSwitch !== undefined && window.__tabSwitch.painted !== null",
        undefined,
        { timeout: 30_000 },
      );
      if (profileDir !== undefined) {
        const { profile } = await cdp.send("Profiler.stop");
        Fs.mkdirSync(profileDir, { recursive: true });
        Fs.writeFileSync(
          Path.join(profileDir, `${step.replaceAll(/[^a-z0-9]+/gi, "-")}.cpuprofile`),
          JSON.stringify(profile),
        );
      }
      return body.evaluate(read);
    };

    /**
     * The first time a tab opens: its layout and its rows show at once, because the app loaded
     * the tab's code and first data while it was idle.
     */
    const first = async (tab: Tab) => {
      const step = `first visit: ${tab.label}`;
      const shown = await go(step, tab);
      rows.push({
        step,
        what: "layout",
        millis: shown.layout,
        problems: shown.layout! > budgetMillis ? [`layout after ${budgetMillis} ms`] : [],
      });
      rows.push({
        step,
        what: "rows",
        millis: shown.painted,
        problems: [
          ...(shown.painted! > budgetMillis ? [`rows after ${budgetMillis} ms`] : []),
          ...(shown.skeleton ? ["showed a skeleton"] : []),
        ],
      });
      await page.waitForLoadState("networkidle");
    };

    /**
     * A tab that was open before: its rows are there in the first frame, then it refreshes. With
     * `hover` it is a tab that was never open, after the pointer rested on it: the same, since the
     * hover loaded its data.
     */
    const again = async (tab: Tab, { scrollY = 0, hover = false } = {}) => {
      const step = `${hover ? "hovered" : "visited"}: ${tab.label}`;
      // A tab's answer counts as fresh for a moment (`ApiAtoms.prefetchFreshMillis`): a visit
      // right after another one rightly asks nothing, so the walk lets that moment pass.
      await sleep(freshMillis);
      if (hover) {
        requests.length = 0;
        // Away from the nav first, so the pointer comes onto the tab.
        await page.mouse.move(700, 500);
        await page.getByRole("navigation", { name: "Main" }).getByText(tab.label).hover();
        await sleep(apiDelay + 250);
        await page.waitForLoadState("networkidle");
      }
      const hovered = [...requests];
      const painted = await go(step, tab);
      // The refresh behind the rows: they stay, and no skeleton takes their place.
      await sleep(apiDelay + 250);
      await page.waitForLoadState("networkidle");
      const settled = await page.locator("body").evaluate(read);
      const problems = [
        ...(painted.painted! > budgetMillis ? [`over ${budgetMillis} ms`] : []),
        ...(settled.skeleton ? ["showed a skeleton"] : []),
        ...(settled.blank ? ["showed an empty page"] : []),
        // The tab's own data, not the auth guard's `/auth/me`. A hover asks for it, and the page
        // that opens right after doesn't ask a second time.
        ...(![...hovered, ...requests].includes(tab.data) ? [`didn't ask for ${tab.data}`] : []),
        ...(hover && requests.includes(tab.data) ? [`asked for ${tab.data} twice`] : []),
        ...(Math.abs(painted.scrollY - scrollY) > 1
          ? [`scrolled to ${painted.scrollY}, was at ${scrollY}`]
          : []),
      ];
      rows.push({ step, what: "rows", millis: painted.painted, problems });
    };

    await first(tabs.openNow);
    await again(tabs.settings, { hover: true });
    for (let round = 0; round < 2; round++) {
      await again(tabs.inbox);
      await again(tabs.openNow);
      await again(tabs.settings);
    }
    // Each tab keeps its place: down the Inbox, away, and back.
    await again(tabs.inbox);
    await page.mouse.wheel(0, 600);
    await page.waitForFunction("window.scrollY === 600");
    await again(tabs.openNow);
    await again(tabs.inbox, { scrollY: 600 });

    // A link saved on another device while Open now is open: the Inbox shows it on the way back,
    // from the refresh behind its cached rows.
    await again(tabs.openNow);
    api.savedElsewhere = true;
    await again(tabs.inbox, { scrollY: 600 });
    const arrived = await page
      .locator("[data-slot=link-row]", { hasText: elsewhere.title })
      .first()
      .waitFor({ timeout: apiDelay + 5000 })
      .then(
        () => true,
        () => false,
      );
    rows.push({
      step: "saved elsewhere: Inbox",
      what: "the new link",
      millis: null,
      problems: arrived ? [] : ["a link saved on another device never showed"],
    });

    for (const error of errors) {
      rows.push({ step: "page error", what: error, millis: null, problems: ["page error"] });
    }
    await context.close();
  }
  return rows;
};

/**
 * How many walks the check may take. A busy machine can make any one frame late, so a walk with a
 * problem is repeated; a real one (a page that waits for the network, a skeleton) is there every
 * time.
 */
const attempts = measuring ? 1 : 3;

const main = async () => {
  const server = await PreviewServer.serve(port);
  let browser: Browser | undefined;
  let rows: ReadonlyArray<Row> = [];
  try {
    browser = await chromium.launch();
    for (let attempt = 1; attempt <= attempts; attempt++) {
      rows = await walk(browser);
      if (rows.every((row) => row.problems.length === 0)) break;
      if (attempt < attempts) console.log(`Walk ${attempt} had problems, walking again.`);
    }
  } finally {
    await browser?.close();
    if (server?.pid !== undefined) process.kill(-server.pid, "SIGTERM");
  }

  const conditions = [
    `cpu ×${cpu}`,
    `api ${apiDelay} ms`,
    `${slowNetwork ? "throttled" : "local"} network`,
  ].join(", ");
  console.log(`Tab switches on the built app (${conditions}):\n`);
  for (const row of rows) {
    const millis = row.millis === null ? "" : `${row.millis.toFixed(0).padStart(5)} ms`;
    const problems = row.problems.length === 0 ? "" : `  ✗ ${row.problems.join(", ")}`;
    console.log(`${row.step.padEnd(24)} ${row.what.padEnd(30)} ${millis}${problems}`);
  }
  const failed = rows.filter((row) => row.problems.length > 0);
  if (failed.length === 0) console.log("\nTab switch check passed.");
  else if (measuring) console.log(`\n${failed.length} over the budget (measurement only).`);
  else {
    console.error(`\n${failed.length} tab switch problem(s).`);
    process.exitCode = 1;
  }
};

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
