// `pnpm --filter @stash/web audit:layout`: the layout audit (docs/design.md, "Layout audit").
// It serves the built app with `vite preview`, answers the api from synthetic fixtures in the
// browser (`layout-fixtures.ts`, seeded and first-run), and checks every page in the light theme at
// desktop (1440) and phone (390) width against the rules in `layout-audit-rules.ts`: control
// heights, phone hit areas, controls on one row, content edges, cards, row heights, gaps and mono
// text. It prints a table of violations and exits 1 if there is any. One browser, one page at a
// time.
import { chromium, type Page } from "playwright";
import { probe } from "./layout-audit-probe.ts";
import { audit, type Violation } from "./layout-audit-rules.ts";
import * as Fixtures from "./layout-fixtures.ts";
import * as PreviewImages from "./preview-images.ts";
import * as PreviewServer from "./preview-server.ts";

const port = Number(process.env["STASH_AUDIT_PORT"] ?? 4179);
const baseUrl = `http://localhost:${port}`;

const viewports = [
  { name: "desktop", width: 1440, height: 900, phone: false },
  { name: "phone", width: 390, height: 844, phone: true },
] as const;

interface View {
  readonly name: string;
  readonly path: string;
  readonly data: "seeded" | "empty" | "none";
  readonly prepare: (page: Page) => Promise<unknown>;
  /** A returning user: the browser already holds recent searches. */
  readonly recentSearches?: boolean;
}

const views: ReadonlyArray<View> = [
  {
    name: "inbox",
    path: "/links",
    data: "seeded",
    prepare: (page) => page.locator("[data-slot=link-day]").first().waitFor(),
  },
  {
    name: "open-now",
    path: "/open-now",
    data: "seeded",
    prepare: (page) => page.locator("[data-section]").first().waitFor(),
  },
  {
    // Searching: the header's field filters the Inbox in place.
    name: "inbox-search",
    path: "/links",
    data: "seeded",
    prepare: async (page) => {
      await page.getByRole("searchbox", { name: "Search links" }).fill("economics");
      await page.locator("[data-slot=search-results] [data-slot=link-row]").first().waitFor();
    },
  },
  {
    // The focused, empty field of a returning user: recent searches hang under it.
    name: "inbox-search-recent",
    path: "/links",
    data: "seeded",
    recentSearches: true,
    prepare: async (page) => {
      await page.locator("[data-slot=link-day]").first().waitFor();
      await page.getByRole("searchbox", { name: "Search links" }).focus();
      await page.locator("[data-recent]").first().waitFor();
    },
  },
  {
    // A selected row, with its action bar.
    name: "inbox-selected",
    path: "/links",
    data: "seeded",
    prepare: async (page) => {
      await page.locator("[data-slot=link-day]").first().waitFor();
      await page.keyboard.press("ArrowDown");
      await page.locator("[data-slot=media-row-actions]").waitFor();
    },
  },
  {
    name: "open-now-selected",
    path: "/open-now",
    data: "seeded",
    prepare: async (page) => {
      await page
        .locator("[data-tab]")
        .first()
        .click({ position: { x: 4, y: 4 } });
      await page.locator("[data-slot=media-row-actions]").waitFor();
    },
  },
  {
    name: "settings",
    path: "/settings",
    data: "seeded",
    prepare: async (page) => {
      await page.locator("[data-source]").first().waitFor();
      await page.locator("[data-test=device]").first().waitFor();
    },
  },
  ...(["iphone", "extension", "mac", "claude"] as const).map((guide) => ({
    name: `settings-${guide}`,
    path: `/settings?guide=${guide}`,
    data: "seeded" as const,
    prepare: (page: Page) => page.locator(`[data-guide=${guide}]`).waitFor(),
  })),
  {
    name: "connect-extension-approve",
    path: `/connect/extension?code=${"c".repeat(43)}`,
    data: "seeded",
    prepare: (page) => page.locator("[data-action=approve]").waitFor(),
  },
  {
    name: "save",
    path: "/save?url=https://example.com/saved",
    data: "seeded",
    prepare: (page) => page.locator("[data-action=back]").waitFor(),
  },
  // A link's page: a YouTube video with its thumbnail and play button, an article with an
  // og:image, and a link with no image (the generated cover).
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
    data: "seeded" as const,
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
      data: "seeded" as const,
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
    name: "inbox-empty",
    path: "/links",
    data: "empty",
    prepare: (page) => page.locator("[data-slot=start-saving]").waitFor(),
  },
  {
    name: "open-now-empty",
    path: "/open-now",
    data: "empty",
    prepare: (page) => page.locator("[data-slot=start-saving]").waitFor(),
  },
  {
    name: "settings-empty",
    path: "/settings",
    data: "empty",
    prepare: async (page) => {
      await page.locator("[data-source]").first().waitFor();
      await page.locator("[data-test=no-devices]").waitFor();
    },
  },
  {
    name: "login",
    path: "/login",
    data: "none",
    prepare: (page) => page.getByRole("button", { name: /sign in/i }).waitFor(),
  },
];

const answer = async (page: Page, data: View["data"]) => {
  const fixtures = data === "seeded" ? Fixtures.seeded(Date.now()) : Fixtures.empty;
  // The seeded links' preview images are drawn here; nothing is fetched from the network.
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
  return page.route("**/api/**", (route) => {
    const request = route.request();
    const body =
      data === "none" ? undefined : fixtures.answer(request.method(), new URL(request.url()));
    return body === undefined
      ? route.fulfill({ status: data === "none" ? 401 : 404, json: { _tag: "NotFound" } })
      : route.fulfill({ json: body });
  });
};

/** A page that never reached the state the audit measures. */
interface LoadFailure {
  readonly rule: "load";
  readonly element: string;
  readonly detail: string;
}

const table = (rows: ReadonlyArray<ReadonlyArray<string>>) => {
  const widths = rows[0]!.map((_, i) => Math.min(60, Math.max(...rows.map((r) => r[i]!.length))));
  return rows
    .map((row) => row.map((cell, i) => cell.slice(0, 60).padEnd(widths[i]!)).join("  "))
    .join("\n");
};

const main = async () => {
  const server = await PreviewServer.serve(port);
  const browser = await chromium.launch();
  const found: Array<readonly [string, Violation | LoadFailure]> = [];
  try {
    for (const viewport of viewports) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        colorScheme: "light",
        deviceScaleFactor: 1,
        reducedMotion: "reduce",
      });
      for (const view of views) {
        const page = await context.newPage();
        const errors: Array<string> = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (message) => {
          if (message.type() === "error") errors.push(message.text());
        });
        await answer(page, view.data);
        // Recent searches live in the browser: a returning user has some, everyone else none.
        const [key, value] = Fixtures.recentSearches(Date.now());
        // As a string, so the script itself never names the DOM globals.
        await page.addInitScript(
          view.recentSearches
            ? `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(value)})`
            : `localStorage.removeItem(${JSON.stringify(key)})`,
        );
        await page.goto(`${baseUrl}${view.path}`);
        const name = `${view.name} · ${viewport.name}`;
        const ready = await view.prepare(page).then(
          () => true,
          (error: unknown) => {
            const why = error instanceof Error ? error.message.split("\n")[0]! : String(error);
            found.push([
              name,
              { rule: "load", element: view.path, detail: [why, ...errors].join(" | ") },
            ]);
            return false;
          },
        );
        if (!ready) {
          console.log(`✗ ${name} (never got ready)`);
          await page.close();
          continue;
        }
        await page.waitForLoadState("networkidle");
        await page.evaluate("document.fonts.ready");
        const snapshot = await page.locator("body").evaluate(probe);
        const violations = audit(snapshot, { phone: viewport.phone });
        for (const violation of violations) found.push([name, violation]);
        // The media rows the page has and how tall they are, so a pass shows what was compared.
        const heights = [...new Set(snapshot.rows.map((row) => Math.round(row.height)))];
        const rows =
          snapshot.rows.length === 0
            ? ""
            : ` (${snapshot.rows.length} rows, ${heights.join(" / ")}px)`;
        console.log(`${violations.length === 0 ? "✓" : "✗"} ${name}${rows}`);
        await page.close();
      }
      await context.close();
    }
  } finally {
    await browser.close();
    if (server?.pid !== undefined) process.kill(-server.pid, "SIGTERM");
  }

  if (found.length > 0) {
    console.error(`\n${found.length} layout violation(s):\n`);
    console.error(
      table([
        ["page", "rule", "element", "detail"],
        ...found.map(([page, v]) => [page, v.rule, v.element, v.detail]),
      ]),
    );
    process.exitCode = 1;
  } else {
    console.log("\nLayout audit passed.");
  }
};

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
