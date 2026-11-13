// `pnpm --filter @stash/web audit:layout`: the layout audit (docs/design.md, "Layout audit").
// It serves the built app with `vite preview`, answers the api from synthetic fixtures in the
// browser (`layout-fixtures.ts`, seeded and first-run), and checks every page in the light theme at
// desktop (1440) and phone (390) width against the rules in `layout-audit-rules.ts`: control
// heights, phone hit areas, controls on one row, content edges, cards, gaps and mono text. It prints
// a table of violations and exits 1 if there is any. One browser, one page at a time.
import { type ChildProcess, spawn } from "node:child_process";
import * as Http from "node:http";
import * as Path from "node:path";
import { chromium, type Page } from "playwright";
import { probe } from "./layout-audit-probe.ts";
import { audit, type Violation } from "./layout-audit-rules.ts";
import * as Fixtures from "./layout-fixtures.ts";

const appDir = Path.resolve(import.meta.dirname, "..");
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
    name: "search",
    path: "/search",
    data: "seeded",
    prepare: async (page) => {
      await page.getByRole("searchbox", { name: "Search links" }).fill("economics");
      await page.locator("[data-hit]").first().waitFor();
    },
  },
  {
    name: "settings",
    path: "/settings",
    data: "seeded",
    prepare: (page) => page.locator("[data-test=device]").first().waitFor(),
  },
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
    name: "search-empty",
    path: "/search",
    data: "empty",
    prepare: (page) => page.getByRole("searchbox", { name: "Search links" }).waitFor(),
  },
  {
    name: "settings-empty",
    path: "/settings",
    data: "empty",
    prepare: (page) => page.locator("[data-test=no-devices]").waitFor(),
  },
  {
    name: "login",
    path: "/login",
    data: "none",
    prepare: (page) => page.getByRole("button", { name: /sign in/i }).waitFor(),
  },
];

// node:http keeps the script off the `fetch` global, which oxlint reserves for platform packages.
const status = (url: string): Promise<number> =>
  new Promise((resolve) => {
    const req = Http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("error", () => resolve(0));
  });

const serve = async (): Promise<ChildProcess | undefined> => {
  if ((await status(`${baseUrl}/login`)) === 200) return undefined;
  const child = spawn(
    "node_modules/.bin/vite",
    ["preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    { cwd: appDir, stdio: ["ignore", "pipe", "pipe"], detached: true },
  );
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString()));
  const deadline = Date.now() + 60_000;
  while ((await status(`${baseUrl}/login`)) !== 200) {
    if (Date.now() > deadline || child.exitCode !== null) {
      throw new Error(`vite preview didn't start (run \`vite build\` first?)\n${output}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return child;
};

const answer = (page: Page, data: View["data"]) => {
  const fixtures = data === "seeded" ? Fixtures.seeded(Date.now()) : Fixtures.empty;
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
  const server = await serve();
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
        console.log(`${violations.length === 0 ? "✓" : "✗"} ${name}`);
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
