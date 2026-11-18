// `pnpm --filter @stash/web check:tab-switch` (after a build; CI job `layout-audit` runs it): the
// speed of the header tabs on the built app. It serves the build with `vite preview`, answers the
// api from the layout fixtures after a delay (so a page that waits for the network shows it), and
// clicks through Inbox, Open now and Settings in headless Chromium, one page at a time.
//
// It fails when a switch to a tab that was already open
// - takes more than `budgetMillis` from the click to the frame that shows the tab's rows,
// - shows a skeleton or an empty page area, then or while the tab refreshes behind,
// - doesn't ask the api again (the cached rows must be revalidated),
// - or loses the tab's scroll position.
// And when the first visit of a tab doesn't show its layout (the page title) within the budget,
// which needs the tab's code to be there before the click, or when a tab the pointer rested on
// doesn't open with its rows, which needs the hover to have loaded its data.
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
}

const tabs = {
  inbox: { label: "Inbox", title: "Inbox", rows: "[data-slot=link-day] [data-slot=link-row]" },
  openNow: { label: "Open now", title: "Open now", rows: "[data-section] [data-tab]" },
  settings: { label: "Settings", title: "Settings", rows: "[data-test=device]" },
} as const satisfies Record<string, Tab>;

const sleep = (millis: number) => new Promise((resolve) => setTimeout(resolve, millis));

const answer = async (page: Page, requests: Array<string>) => {
  const fixtures = Fixtures.seeded(Date.now());
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
    const body = fixtures.answer(request.method(), url);
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

const main = async () => {
  const server = await PreviewServer.serve(port);
  const rows: Array<Row> = [];
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      colorScheme: "light",
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    const errors: Array<string> = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const requests: Array<string> = [];
    await answer(page, requests);
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

    await page.goto(`${baseUrl}/links`);
    await page.locator(tabs.inbox.rows).first().waitFor();
    // The tabs' code is fetched once the app is idle.
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

    /** The first time a tab opens: its layout shows at once, its rows when the api answers. */
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
        what: `rows (api answers in ${apiDelay} ms)`,
        millis: shown.painted,
        problems: [],
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
      if (hover) {
        await page.getByRole("navigation", { name: "Main" }).getByText(tab.label).hover();
        await sleep(apiDelay + 250);
        await page.waitForLoadState("networkidle");
      }
      const painted = await go(step, tab);
      // The refresh behind the rows: they stay, and no skeleton takes their place.
      await sleep(apiDelay + 250);
      await page.waitForLoadState("networkidle");
      const settled = await page.locator("body").evaluate(read);
      const problems = [
        ...(painted.painted! > budgetMillis ? [`over ${budgetMillis} ms`] : []),
        ...(settled.skeleton ? ["showed a skeleton"] : []),
        ...(settled.blank ? ["showed an empty page"] : []),
        // A hover has just loaded the data, so the page that opens right after doesn't ask again.
        ...(requests.length === 0 && !hover ? ["didn't refresh its data"] : []),
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

    for (const error of errors) {
      rows.push({ step: "page error", what: error, millis: null, problems: ["page error"] });
    }
    await context.close();
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
