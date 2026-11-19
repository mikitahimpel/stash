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
// - the row changes its height, or the Cumulative Layout Shift from the event on is over `maxCls`.
import { type Browser, chromium, type Page, type WebSocketRoute } from "playwright";
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

interface Api {
  /** The streams the page opened. */
  readonly streams: Array<WebSocketRoute>;
  /** How often the Inbox was asked for. */
  lists: number;
}

const answer = async (page: Page, now: number): Promise<Api> => {
  const fixtures = Fixtures.seeded(now);
  const api: Api = { streams: [], lists: 0 };
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

const main = async () => {
  const server = await PreviewServer.serve(port);
  let browser: Browser | undefined;
  const problems: Array<string> = [];
  try {
    browser = await chromium.launch();
    for (const viewport of viewports) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        colorScheme: "light",
      });
      const page = await context.newPage();
      const now = Date.now();
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
      if (loads !== 1) found.push(`the page loaded ${loads} times`);

      console.log(
        `${found.length === 0 ? "✓" : "✗"} inbox · ${viewport.name}  CLS ${shift.toFixed(4)}`,
      );
      for (const problem of found) problems.push(`inbox · ${viewport.name}: ${problem}`);
      await context.close();
    }
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
