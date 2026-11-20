// `pnpm --filter @stash/web check:live-updates` (after a build; CI job `layout-audit` runs it):
// live link updates in the built app (docs/architecture.md, "Live updates"). It serves the build
// with `vite preview`, answers the api from the layout fixtures with one link that enrichment has
// not reached yet at the top of the Inbox, and plays the api's event stream (`/api/events`, a
// WebSocket) itself, in headless Chromium at desktop and phone width, one page at a time.
//
// It fails when
// - the app opens no stream, or more than one,
// - the row does not say `summarizing…` before the event, or still does after it,
// - the summary of the `link.updated` event does not show (desktop; a phone row has no summary
//   line), or the Inbox was asked for again, or the page was loaded again,
// - the row changes its height, or the Cumulative Layout Shift from the event on is over `maxCls`,
// - a link saved on another device (a `link.updated` for a link the page does not hold) does not
//   appear on top of the Inbox with its device's name, or it takes a request, or the rows under it
//   do not end one row lower, or the page shifts by more than `maxCls` while they make room,
// - on Open now (#182), a tab opened in a fake extension client (which reports its tabs as the
//   extension does, and the fake api sends the `tabs.updated` the real one would) does not show
//   within `tabWithinMillis`, or a tab closed there does not fade out and leave, or either asks
//   the api for the tabs again, reloads the page, or shifts it by more than `maxCls`.
import { type Browser, chromium, type Page, type WebSocketRoute } from "playwright";
import * as CheckClock from "./check-clock.ts";
import * as Fixtures from "./layout-fixtures.ts";
import { boxes, record, shifts } from "./loading-states-probe.ts";
import * as PreviewImages from "./preview-images.ts";
import * as PreviewServer from "./preview-server.ts";

const port = Number(process.env["STASH_AUDIT_PORT"] ?? 4179);
const baseUrl = `http://localhost:${port}`;

/** The most the page may shift while a link turns from pending into enriched. */
export const maxCls = 0.01;
/** How far the row's height may be from what it was, in px. */
export const maxOff = 1;

const viewports = [
  { name: "desktop", width: 1440, height: 900, summary: true },
  { name: "phone", width: 390, height: 844, summary: false },
] as const;

const pendingId = "seed-link-pending";
const summary = "A synthetic summary that the live stream brought, with no reload of the page.";
const row = `[data-slot=link-row]:has(a[href="/links/${pendingId}"])`;

const phoneId = "seed-link-phone";
const phoneRow = `[data-slot=link-row]:has(a[href="/links/${phoneId}"])`;

/** How soon a tab opened on a device must show in Open now. */
export const tabWithinMillis = 3000;

const sleep = (millis: number) => new Promise((resolve) => setTimeout(resolve, millis));

/** The link as it was saved a moment ago, and as enrichment leaves it. */
const pendingLink = (now: number) => ({
  id: pendingId,
  url: "https://example.com/live/pending",
  canonicalUrl: null,
  title: "A link saved a moment ago",
  status: "new",
  type: null,
  summary: null,
  language: null,
  tags: [],
  sourceDeviceId: null,
  createdAt: new Date(now - 5000).toISOString(),
  updatedAt: new Date(now - 5000).toISOString(),
  imageUrl: null,
  author: null,
  enrichedAt: null,
});

const enrichedLink = (now: number) => ({
  ...pendingLink(now),
  type: "article",
  summary,
  language: "en",
  tags: ["live", "updates"],
  author: "Mara Lindqvist",
  imageUrl: `${PreviewImages.origin}live/pending.svg`,
  updatedAt: new Date(now).toISOString(),
  enrichedAt: new Date(now).toISOString(),
});

/** A link saved on another device a moment after the page loaded. */
const phoneLink = (now: number, deviceId: string) => ({
  ...pendingLink(now),
  id: phoneId,
  url: "https://example.com/live/from-the-phone",
  title: "A link saved on the phone just now",
  sourceDeviceId: deviceId,
  createdAt: new Date(now + 1000).toISOString(),
  updatedAt: new Date(now + 1000).toISOString(),
});

interface Api {
  /** The streams the page opened. */
  readonly streams: Array<WebSocketRoute>;
  /** How often the Inbox was asked for. */
  lists: number;
  /** A device of the fixtures: its id and name. */
  readonly device: { readonly id: string; readonly name: string };
}

const answer = async (page: Page, now: number): Promise<Api> => {
  const fixtures = Fixtures.seeded(now);
  const [device] = fixtures.answer("GET", new URL(`${baseUrl}/api/devices`)) as ReadonlyArray<{
    readonly id: string;
    readonly name: string;
  }>;
  if (device === undefined) throw new Error("the fixtures have no device");
  const api: Api = { streams: [], lists: 0, device };
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
  await page.route("**/api/**", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    let body: unknown = fixtures.answer(request.method(), url);
    if (request.method() === "GET" && url.pathname === "/api/links") {
      // The catch-up filters find nothing: this check is about the stream alone.
      if (url.searchParams.has("ids") || url.searchParams.has("updatedSince")) {
        body = { items: [], nextCursor: null };
      } else {
        api.lists++;
        const page = body as { items: ReadonlyArray<unknown>; nextCursor: null };
        body = { ...page, items: [pendingLink(now), ...page.items] };
      }
    }
    return body === undefined
      ? route.fulfill({ status: 404, json: { _tag: "NotFound" } })
      : route.fulfill({ json: body });
  });
  await page.routeWebSocket(/\/api\/events$/, (socket) => {
    api.streams.push(socket);
    socket.onMessage((message) => {
      if (message === "ping") socket.send("pong");
    });
    socket.send(JSON.stringify({ type: "stream.ready", at: new Date(now).toISOString() }));
  });
  return api;
};

/**
 * A browser with the extension, as far as Open now can tell: it holds its tabs and reports the
 * whole set after each change, the way `@stash/ext-tab-sync` does. The fake api answers the
 * report as the real one: it stores the set (later `GET /tabs` answers it) and sends
 * `tabs.updated` to every open stream.
 */
const fakeExtension = async (page: Page, now: number) => {
  const fixtures = Fixtures.seeded(now);
  const all = fixtures.answer("GET", new URL(`${baseUrl}/api/tabs`)) as {
    devices: Array<{
      device: { readonly id: string };
      snapshot: { deviceId: string; takenAt: string; tabs: Array<Record<string, unknown>> };
      saved: ReadonlyArray<unknown>;
    }>;
  };
  const browser = all.devices[0]!;
  const streams: Array<WebSocketRoute> = [];
  let tabLists = 0;
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
  await page.route("**/api/**", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "GET" && url.pathname === "/api/tabs") {
      tabLists++;
      return route.fulfill({ json: all });
    }
    const body = fixtures.answer(request.method(), url);
    return body === undefined
      ? route.fulfill({ status: 404, json: { _tag: "NotFound" } })
      : route.fulfill({ json: body });
  });
  await page.routeWebSocket(/\/api\/events$/, (socket) => {
    streams.push(socket);
    socket.onMessage((message) => {
      if (message === "ping") socket.send("pong");
    });
    socket.send(JSON.stringify({ type: "stream.ready", at: new Date(now).toISOString() }));
  });
  let clock = now;
  /** The browser reports its tabs (`PUT /devices/:id/tabs`); the api tells the streams. */
  const report = () => {
    clock += 2000;
    const at = new Date(clock).toISOString();
    browser.snapshot = { ...browser.snapshot, takenAt: at, tabs: [...browser.snapshot.tabs] };
    for (const stream of streams) {
      stream.send(
        JSON.stringify({
          type: "tabs.updated",
          at,
          device: { ...browser.device, createdAt: new Date(now - 40 * 86_400_000).toISOString() },
          snapshot: browser.snapshot,
          saved: browser.saved,
        }),
      );
    }
  };
  return {
    streams,
    tabLists: () => tabLists,
    /** Opens a tab at `index` of the first window. */
    open: (index: number, tab: { readonly url: string; readonly title: string }) => {
      const at = new Date(clock).toISOString();
      browser.snapshot.tabs.splice(index, 0, {
        ...tab,
        openedAt: at,
        lastSeenAt: at,
        lastActiveAt: at,
        window: { id: "1" },
      });
      report();
    },
    /** Closes the tab with this url. */
    close: (url: string) => {
      browser.snapshot.tabs = browser.snapshot.tabs.filter((tab) => tab["url"] !== url);
      report();
    },
    url: (index: number) => String(browser.snapshot.tabs[index]?.["url"]),
  };
};

const openNow = async (browser: Browser, viewport: (typeof viewports)[number]) => {
  const found: Array<string> = [];
  const context = await CheckClock.newContext(browser, {
    viewport: { width: viewport.width, height: viewport.height },
    colorScheme: "light",
  });
  const page = await context.newPage();
  const now = CheckClock.now();
  const extension = await fakeExtension(page, now);
  await page.addInitScript(record);
  let loads = 0;
  page.on("load", () => loads++);
  await page.goto(`${baseUrl}/open-now`);
  await page.locator("[data-slot=compact-row]").first().waitFor();
  await page.waitForLoadState("networkidle");
  await page.evaluate("document.fonts.ready");
  await sleep(500);
  if (extension.streams.length !== 1) {
    found.push(`${extension.streams.length} streams opened, not one`);
  }
  const listsBefore = extension.tabLists();
  const clsBefore = (await page.locator("body").evaluate(shifts)).cls;

  // A tab opened on the device, above the rows the reader sees.
  const opened = { url: "https://example.com/live/opened-tab", title: "A tab opened just now" };
  const openedRow = `[data-slot=compact-row]:has(a[href="${opened.url}"])`;
  const started = Date.now();
  extension.open(1, opened);
  const shown = await page
    .locator(openedRow)
    .waitFor({ timeout: tabWithinMillis })
    .then(
      () => true,
      () => false,
    );
  const tookMillis = Date.now() - started;
  if (!shown) found.push(`the opened tab did not show within ${tabWithinMillis} ms`);
  await sleep(800);
  const afterOpen = await page.locator("body").evaluate(shifts);
  const openShift = afterOpen.cls - clsBefore;
  if (openShift > maxCls) {
    found.push(
      `CLS ${openShift.toFixed(4)} > ${maxCls} when a tab opened: ${afterOpen.moved.join("; ")}`,
    );
  }

  // A tab closed on the device: it fades out at its place, then leaves.
  const closedUrl = extension.url(3);
  const closedRow = `[data-slot=compact-row]:has(a[href="${closedUrl}"])`;
  extension.close(closedUrl);
  const faded = await page
    .locator(`${closedRow}[data-leaving]`)
    .waitFor({ timeout: tabWithinMillis })
    .then(
      () => true,
      () => false,
    );
  if (!faded) found.push("the closed tab did not fade out");
  const gone = await page
    .locator(closedRow)
    .waitFor({ state: "detached", timeout: tabWithinMillis })
    .then(
      () => true,
      () => false,
    );
  if (!gone) found.push("the closed tab is still on the page");
  await sleep(800);
  const afterClose = await page.locator("body").evaluate(shifts);
  const closeShift = afterClose.cls - afterOpen.cls;
  if (closeShift > maxCls) {
    found.push(
      `CLS ${closeShift.toFixed(4)} > ${maxCls} when a tab closed: ${afterClose.moved.slice(afterOpen.moved.length).join("; ")}`,
    );
  }
  if (extension.tabLists() !== listsBefore) found.push("Open now asked the api for the tabs again");
  if (loads !== 1) found.push(`the page loaded ${loads} times`);
  console.log(
    `${found.length === 0 ? "✓" : "✗"} open now · ${viewport.name}  shown in ${tookMillis} ms, CLS ${openShift.toFixed(4)} opened, ${closeShift.toFixed(4)} closed`,
  );
  await context.close();
  return found.map((problem) => `open now · ${viewport.name}: ${problem}`);
};

const main = async () => {
  const server = await PreviewServer.serve(port);
  let browser: Browser | undefined;
  const problems: Array<string> = [];
  try {
    browser = await chromium.launch();
    for (const viewport of viewports) {
      const context = await CheckClock.newContext(browser, {
        viewport: { width: viewport.width, height: viewport.height },
        colorScheme: "light",
      });
      const page = await context.newPage();
      const now = CheckClock.now();
      const api = await answer(page, now);
      await page.addInitScript(record);
      let loads = 0;
      page.on("load", () => loads++);
      await page.goto(`${baseUrl}/links`);
      const found: Array<string> = [];

      await page.locator(row).waitFor();
      await page.waitForLoadState("networkidle");
      await page.evaluate("document.fonts.ready");
      await sleep(500);
      const waiting = viewport.summary
        ? "[data-slot=link-summarizing]"
        : "[data-slot=link-summarizing-meta]";
      if (!(await page.locator(`${row} ${waiting}`).isVisible())) {
        found.push("the row does not say `summarizing…` before the event");
      }
      if (api.streams.length !== 1) found.push(`${api.streams.length} streams opened, not one`);
      const before = (await page.locator("body").evaluate(boxes, { row }))["row"];
      const clsBefore = (await page.locator("body").evaluate(shifts)).cls;
      const listsBefore = api.lists;

      for (const stream of api.streams) {
        stream.send(
          JSON.stringify({
            type: "link.updated",
            at: new Date(now).toISOString(),
            link: enrichedLink(now),
          }),
        );
      }
      const turned = await page
        .locator(`${row} ${waiting}`)
        .waitFor({ state: "detached", timeout: 5000 })
        .then(
          () => true,
          () => false,
        );
      if (!turned) found.push("the row still says `summarizing…` after the event");
      if (viewport.summary) {
        const text = await page
          .locator(`${row} [data-slot=link-summary]`)
          .textContent({ timeout: 2000 })
          .catch(() => null);
        if (text?.trim() !== summary) found.push(`the summary did not show (${String(text)})`);
      }
      // The preview image loads, and a frame for what comes after it.
      await page.waitForLoadState("networkidle");
      await sleep(500);
      const after = (await page.locator("body").evaluate(boxes, { row }))["row"];
      const { cls, moved } = await page.locator("body").evaluate(shifts);
      const shift = cls - clsBefore;
      if (before == null || after == null) found.push("the row is not on the page");
      else if (Math.abs(before.height - after.height) > maxOff) {
        found.push(
          `row height ${before.height.toFixed(1)} before, ${after.height.toFixed(1)} after`,
        );
      }
      if (shift > maxCls) found.push(`CLS ${shift.toFixed(4)} > ${maxCls}: ${moved.join("; ")}`);
      if (api.lists !== listsBefore) found.push("the Inbox was asked for again");

      // A link saved on another device: it appears on top, and the rows make room without a jump.
      for (const stream of api.streams) {
        stream.send(
          JSON.stringify({
            type: "link.updated",
            at: new Date(now + 1000).toISOString(),
            link: phoneLink(now, api.device.id),
          }),
        );
      }
      const appeared = await page
        .locator(phoneRow)
        .waitFor({ timeout: 5000 })
        .then(
          () => true,
          () => false,
        );
      if (!appeared) found.push("the link saved on another device did not appear");
      // The rows slide to their place.
      await page.waitForLoadState("networkidle");
      await sleep(800);
      const placed = await page.locator("body").evaluate(boxes, { row, phone: phoneRow });
      const inserted = await page.locator("body").evaluate(shifts);
      const insertShift = inserted.cls - cls;
      if (appeared && placed["phone"] != null && after != null && placed["row"] != null) {
        const first = await page.locator("[data-slot=link-row]").first().getAttribute("data-slot");
        const top = await page
          .locator("[data-slot=link-row] a[href^='/links/']")
          .first()
          .getAttribute("href");
        if (first === null || top !== `/links/${phoneId}`) {
          found.push(`the new link is not on top of the Inbox (${String(top)} is)`);
        }
        if (Math.abs(placed["phone"].y - after.y) > maxOff) {
          found.push(
            `the new row stands at ${placed["phone"].y.toFixed(1)}, not where the first row was (${after.y.toFixed(1)})`,
          );
        }
        const moved = placed["row"].y - after.y;
        if (Math.abs(moved - placed["phone"].height) > maxOff) {
          found.push(
            `the row under it moved ${moved.toFixed(1)}px, not one row (${placed["phone"].height.toFixed(1)}px)`,
          );
        }
        if (viewport.summary) {
          const text = (await page.locator(phoneRow).textContent()) ?? "";
          if (!text.includes(api.device.name)) found.push("the new row does not name its device");
        }
      }
      if (insertShift > maxCls) {
        found.push(
          `CLS ${insertShift.toFixed(4)} > ${maxCls} when a link arrived: ${inserted.moved.slice(moved.length).join("; ")}`,
        );
      }
      if (api.lists !== listsBefore) found.push("the Inbox was asked for again for the new link");
      if (loads !== 1) found.push(`the page loaded ${loads} times`);

      console.log(
        `${found.length === 0 ? "✓" : "✗"} inbox · ${viewport.name}  CLS ${shift.toFixed(4)} enriched, ${insertShift.toFixed(4)} saved elsewhere`,
      );
      for (const problem of found) problems.push(`inbox · ${viewport.name}: ${problem}`);
      await context.close();
    }
    for (const viewport of viewports) problems.push(...(await openNow(browser, viewport)));
  } finally {
    await browser?.close();
    if (server?.pid !== undefined) process.kill(-server.pid, "SIGTERM");
  }

  if (problems.length > 0) {
    console.error(`\n${problems.length} live update problem(s):\n`);
    for (const problem of problems) console.error(`  ${problem}`);
    process.exitCode = 1;
  } else {
    console.log(`\nLive updates passed (no reload, no request, CLS ≤ ${maxCls}).`);
  }
};

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
