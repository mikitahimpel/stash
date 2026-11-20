// `pnpm --filter @stash/web check:loading` (after a build; CI job `layout-audit` runs it): the
// loading states of the built app (docs/design.md, "Loading states"). It serves the build with
// `vite preview`, answers the api from the layout fixtures after `apiDelay` ms, and opens the
// Inbox, Open now, a link's page and Settings in headless Chromium, at desktop and phone width,
// one page at a time.
//
// For each page it fails when
// - the skeleton never shows (the api is slow enough that it must),
// - a part of the skeleton doesn't have the box of the content that takes its place (± 1px): the
//   first row and its preview, the page header and what stands between them,
// - or the Cumulative Layout Shift from the first paint to the loaded page is over `maxCls`.
// The pages with no data (first run) are held to the same shift limit.
//
// `--screenshots` also writes each page while loading and once loaded to `docs/screenshots/`
// (`loading-<page>-<width>-skeleton.png` and `-loaded.png`).
import * as Path from "node:path";
import { type Browser, chromium, type Page } from "playwright";
import * as CheckClock from "./check-clock.ts";
import * as Fixtures from "./layout-fixtures.ts";
import { type Box, boxes, record, shifts } from "./loading-states-probe.ts";
import * as PreviewImages from "./preview-images.ts";
import * as PreviewServer from "./preview-server.ts";

const port = Number(process.env["STASH_AUDIT_PORT"] ?? 4179);
const baseUrl = `http://localhost:${port}`;
const shots = process.argv.includes("--screenshots");
const shotsDir = Path.resolve(import.meta.dirname, "../../../docs/screenshots");

/** How long the api takes to answer, in ms: long enough for every skeleton to show. */
const apiDelay = Number(process.env["STASH_LOADING_API_DELAY"] ?? (shots ? 2500 : 800));
/** The most a page may shift between its first paint and its loaded state. */
export const maxCls = 0.01;
/** How far a skeleton's box may be from the box of what replaces it, in px. */
export const maxOff = 1;

const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
] as const;

interface View {
  readonly name: string;
  readonly path: string;
  /** Shows that the page has its data. */
  readonly loaded: string;
  /**
   * Pairs of selectors: a part of the skeleton, and what takes its place. `sides` names what is
   * compared where the rest depends on the data (how wide a label is, how many lines a title
   * has, what stands above); by default the whole box.
   */
  readonly parts: Readonly<
    Record<string, readonly [skeleton: string, loaded: string, sides?: ReadonlyArray<Side>]>
  >;
}

const allSides = ["x", "y", "width", "height"] as const;
type Side = (typeof allSides)[number];

const header = "[data-slot=page-header]";
/** The box without its top: what stands above it depends on the data. */
const size = ["x", "width", "height"] as const;

const views: ReadonlyArray<View> = [
  {
    name: "inbox",
    path: "/links",
    loaded: "[data-slot=link-day] [data-slot=link-row]",
    parts: {
      "page header": [header, header],
      filters: ["[role=radiogroup]", "[role=radiogroup]"],
      "group header": [
        "[data-state=loading] [data-slot=group-header]",
        "[data-slot=link-day] [data-slot=group-header]",
      ],
      row: ["[data-skeleton]", "[data-slot=link-row]"],
      preview: [
        "[data-skeleton] [data-shape=thumb]",
        "[data-slot=link-row] [data-slot=media-thumb]",
      ],
      "second row": [
        "[data-skeleton] + [data-skeleton]",
        "[data-slot=link-row] + [data-slot=link-row]",
      ],
    },
  },
  {
    name: "open-now",
    path: "/open-now",
    loaded: "[data-section] [data-tab]",
    parts: {
      "page header": [header, header],
      // On a phone the field takes what Select leaves it, and a label is as wide as its text.
      filter: [
        "[data-state=loading] [data-shape=chip]",
        "[data-slot=search-field]:not(header *)",
        ["x", "y", "height"],
      ],
      "group header": [
        "[data-state=loading] [data-slot=group-header]",
        "[data-section] [data-slot=group-header]",
      ],
      row: ["[data-skeleton]", "[data-tab]"],
      icon: ["[data-skeleton] [data-shape=icon]", "[data-tab] [data-slot=site-icon]"],
      "second row": ["[data-skeleton] + [data-skeleton]", "[data-tab] + [data-tab]"],
    },
  },
  {
    name: "link",
    path: `/links/${Fixtures.articleLinkId}`,
    loaded: "[data-slot=link-details] h1",
    parts: {
      preview: ["[data-state=loading] [data-shape=hero]", "[data-slot=media-hero]"],
      kind: [
        "[data-state=loading] [data-shape=badge]",
        "[data-slot=link-kind]",
        ["x", "y", "height"],
      ],
      // A title has one to three lines.
      title: ["[data-state=loading] [data-shape=title]", "[data-slot=link-details] h1", ["x", "y"]],
      open: ["[data-state=loading] [data-shape=control]", "[data-action=open]", size],
    },
  },
  {
    name: "settings",
    path: "/settings",
    loaded: "[data-test=device]",
    parts: {
      "page header": [header, header],
      "source row": ["#connections > [data-state=loading] [data-skeleton]", "[data-source]"],
      "last source row": [
        "#connections > [data-state=loading] [data-skeleton]:last-child",
        "[data-source]:last-child",
      ],
      "device row": [
        "[data-state=loading] [data-skeleton]:has([data-shape=chip]):not(:has([data-slot=status-dot]))",
        "[data-test=device]",
      ],
    },
  },
];

/** The pages of a new account: nothing to compare, the same limit on the shift. */
const emptyViews = [
  { name: "inbox-empty", path: "/links", loaded: "[data-slot=start-saving]" },
  { name: "open-now-empty", path: "/open-now", loaded: "[data-slot=start-saving]" },
  { name: "settings-empty", path: "/settings", loaded: "[data-test=no-devices]" },
] as const;

const sleep = (millis: number) => new Promise((resolve) => setTimeout(resolve, millis));

const answer = async (page: Page, data: "seeded" | "empty") => {
  const fixtures =
    data === "seeded" ? Fixtures.seeded(CheckClock.now()) : Fixtures.empty(CheckClock.now());
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
    const body = fixtures.answer(request.method(), url);
    // Who is signed in answers at once: the app shows nothing before it knows.
    if (!url.pathname.endsWith("/auth/me")) await sleep(apiDelay);
    return body === undefined
      ? route.fulfill({ status: 404, json: { _tag: "NotFound" } })
      : route.fulfill({ json: body });
  });
};

const differences = (
  name: string,
  skeleton: Box | null,
  loaded: Box | null,
  sides: ReadonlyArray<Side>,
): Array<string> => {
  if (skeleton === null) return [`${name}: no skeleton for it`];
  if (loaded === null) return [`${name}: not on the loaded page`];
  return sides
    .filter((side) => Math.abs(skeleton[side] - loaded[side]) > maxOff)
    .map(
      (side) =>
        `${name}: ${side} ${skeleton[side].toFixed(1)} while loading, ${loaded[side].toFixed(1)} loaded`,
    );
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
        deviceScaleFactor: shots ? 2 : 1,
      });
      const open = async (path: string, data: "seeded" | "empty") => {
        const page = await context.newPage();
        await answer(page, data);
        await page.addInitScript(record);
        await page.goto(`${baseUrl}${path}`);
        return page;
      };
      const settle = async (page: Page, loaded: string) => {
        await page.locator(loaded).first().waitFor();
        await page.waitForLoadState("networkidle");
        await page.evaluate("document.fonts.ready");
        // The skeleton's minimum time, and a frame for what comes after it.
        await sleep(500);
        return page.locator("body").evaluate(shifts);
      };
      const report = (name: string, cls: number, found: ReadonlyArray<string>) => {
        console.log(
          `${found.length === 0 ? "✓" : "✗"} ${name} · ${viewport.name}  CLS ${cls.toFixed(4)}`,
        );
        for (const problem of found) problems.push(`${name} · ${viewport.name}: ${problem}`);
      };

      for (const view of views) {
        const page = await open(view.path, "seeded");
        const found: Array<string> = [];
        const skeletonSelectors = Object.fromEntries(
          Object.entries(view.parts).map(([name, [skeleton]]) => [name, skeleton]),
        );
        const loadedSelectors = Object.fromEntries(
          Object.entries(view.parts).map(([name, [, loaded]]) => [name, loaded]),
        );
        const shown = await page
          .locator("[data-state=loading]")
          .first()
          .waitFor({ timeout: apiDelay + 5000 })
          .then(
            () => true,
            () => false,
          );
        if (!shown) found.push("the skeleton never showed");
        await page.evaluate("document.fonts.ready");
        const before = await page.locator("body").evaluate(boxes, skeletonSelectors);
        if (shots) {
          await page.screenshot({
            path: Path.join(shotsDir, `loading-${view.name}-${viewport.name}-skeleton.png`),
          });
        }
        const { cls, moved } = await settle(page, view.loaded);
        const after = await page.locator("body").evaluate(boxes, loadedSelectors);
        if (shots) {
          await page.screenshot({
            path: Path.join(shotsDir, `loading-${view.name}-${viewport.name}-loaded.png`),
          });
        }
        if (shown) {
          for (const [name, [, , sides]] of Object.entries(view.parts)) {
            found.push(
              ...differences(name, before[name] ?? null, after[name] ?? null, sides ?? allSides),
            );
          }
        }
        if (cls > maxCls) found.push(`CLS ${cls.toFixed(4)} > ${maxCls}: ${moved.join("; ")}`);
        report(view.name, cls, found);
        await page.close();
      }

      for (const view of emptyViews) {
        const page = await open(view.path, "empty");
        const { cls, moved } = await settle(page, view.loaded);
        report(
          view.name,
          cls,
          cls > maxCls ? [`CLS ${cls.toFixed(4)} > ${maxCls}: ${moved.join("; ")}`] : [],
        );
        await page.close();
      }
      await context.close();
    }
  } finally {
    await browser?.close();
    if (server?.pid !== undefined) process.kill(-server.pid, "SIGTERM");
  }

  if (problems.length > 0) {
    console.error(`\n${problems.length} loading state problem(s):\n`);
    for (const problem of problems) console.error(`  ${problem}`);
    process.exitCode = 1;
  } else {
    console.log(
      `\nLoading states passed (api ${apiDelay} ms, CLS ≤ ${maxCls}, boxes ± ${maxOff}px).`,
    );
  }
};

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
