// `pnpm --filter @stash/web walk:connect` (after `vite build`; CI runs it after the layout audit):
// walks every Connect guide (now the first section of Settings) in headless Chromium against the synthetic api of the layout audit
// (`layout-fixtures.ts`, `connectable`), one page at a time in one browser. Each guide creates its
// device or token, shows the prefilled values, and turns to "Connected ✓" once the fixture reports
// the first save, check-in or use. Also the extension's approve page and `/save`. Exits 1 on the
// first step that fails.
import { chromium, type Page } from "playwright";
import * as Fixtures from "./layout-fixtures.ts";
import * as PreviewServer from "./preview-server.ts";

const port = Number(process.env["STASH_WALK_PORT"] ?? 4180);
const baseUrl = `http://localhost:${port}`;
/** A guide polls every 3 s; give it two polls and some slack. */
const arrivalTimeout = 10_000;

const check = (ok: boolean, what: string) => {
  if (!ok) throw new Error(what);
};

/** A page whose api is `api`, and whose extension download says `signed`. */
const open = async (
  page: Page,
  api: ReturnType<typeof Fixtures.connectable>,
  signed: boolean,
): Promise<void> => {
  await page.route("**/api/**", (route) => {
    const request = route.request();
    const answer = api.answer(request.method(), new URL(request.url()), request.postData());
    return answer === undefined
      ? route.fulfill({ status: 404, json: { _tag: "NotFound", resource: "walk", id: "none" } })
      : route.fulfill({ status: answer.status, json: answer.body });
  });
  await page.route("**/downloads/stash-extension.json", (route) =>
    route.fulfill({ json: { signed } }),
  );
};

const value = (page: Page, label: string) => page.getByLabel(label, { exact: true }).inputValue();

const arrived = async (page: Page, text: string) => {
  const line = page.locator("[data-test=arrived]");
  await line.waitFor({ timeout: arrivalTimeout });
  const shown = (await line.textContent())?.trim() ?? "";
  check(shown === text, `expected "${text}", got "${shown}"`);
};

const lastDevice = (api: ReturnType<typeof Fixtures.connectable>) => {
  const device = api.devices().at(-1);
  check(device !== undefined, "no device was registered");
  return device!;
};

const walks: ReadonlyArray<{
  readonly name: string;
  readonly signed?: boolean;
  readonly run: (page: Page, api: ReturnType<typeof Fixtures.connectable>) => Promise<void>;
}> = [
  {
    name: "iPhone guide",
    run: async (page, api) => {
      // The old address, which docs and the extension still link to, lands on the section.
      await page.goto(`${baseUrl}/connect?guide=iphone`);
      await page.waitForURL(`${baseUrl}/settings?guide=iphone#connections`);
      await page.locator("[data-guide=iphone] [data-action=create]").click();
      await page.locator("[data-test=waiting]").waitFor();
      const device = lastDevice(api);
      check(device.kind === "ios", `registered a ${device.kind} device`);
      const url = await value(page, "Shortcut URL");
      check(url === `${baseUrl}/save?device=${device.id}&url=`, `Shortcut URL is ${url}`);
      api.arrive(device.id, "A synthetic article");
      await arrived(page, "Connected ✓ — “A synthetic article” arrived");
    },
  },
  {
    name: "Zen guide, unsigned build",
    signed: false,
    run: async (page) => {
      await page.goto(`${baseUrl}/settings?guide=extension`);
      await page.locator("[data-guide=extension][data-signed=false]").waitFor();
      const href = await page.locator("[data-action=download]").getAttribute("href");
      check(href === `${baseUrl}/downloads/stash-extension.xpi`, `download is ${href}`);
      const install = (await page.locator("[data-test=install]").textContent()) ?? "";
      check(install.includes("Load Temporary Add-on"), "no temporary add-on steps");
    },
  },
  {
    name: "Zen guide, signed build",
    signed: true,
    run: async (page) => {
      await page.goto(`${baseUrl}/settings?guide=extension`);
      await page.locator("[data-guide=extension][data-signed=true]").waitFor();
      const install = (await page.locator("[data-test=install]").textContent()) ?? "";
      check(install.includes("choose Add"), "no install steps for a signed file");
    },
  },
  {
    name: "Zen approve page",
    run: async (page, api) => {
      const code = `Ab3x${"c".repeat(39)}`;
      await page.goto(`${baseUrl}/connect/extension?code=${code}`);
      const shown = await page.locator("[data-test=check-code]").textContent();
      check(shown?.trim() === "Ab3x", `check code is ${shown}`);
      await page.locator("[data-action=approve]").click();
      await page.locator("[data-test=approved]").waitFor();
      const device = lastDevice(api);
      check(device.kind === "zen", `registered a ${device.kind} device`);
      api.arrive(device.id);
      await arrived(page, "Connected ✓ — the extension signed in");
    },
  },
  {
    name: "Mac guide",
    run: async (page, api) => {
      await page.goto(`${baseUrl}/settings?guide=mac`);
      await page.locator("[data-guide=mac] [data-action=create]").click();
      await page.locator("[data-test=waiting]").waitFor();
      const device = lastDevice(api);
      check(device.kind === "mac-agent", `registered a ${device.kind} device`);
      const command = await value(page, "Install command");
      check(command.includes(`STASH_URL='${baseUrl}'`), `install command: ${command}`);
      check(command.includes("STASH_DEVICE_TOKEN='stash_synthetic_walk_"), "no token in command");
      api.arrive(device.id);
      await arrived(page, "Connected ✓ — the Mac agent checked in");
    },
  },
  {
    name: "Claude guide",
    run: async (page, api) => {
      await page.goto(`${baseUrl}/settings?guide=claude`);
      await page.locator("[data-guide=claude] [data-test=waiting]").waitFor();
      const url = await value(page, "Connector URL");
      check(url === "https://mcp.example.com/mcp", `connector URL is ${url}`);
      api.useClaude();
      await arrived(page, "Connected ✓ — Claude used Stash");
    },
  },
  {
    name: "/search?q= opens the Inbox with its results",
    run: async (page) => {
      await page.goto(`${baseUrl}/search?q=economics`);
      await page.waitForURL(`${baseUrl}/links?q=economics`);
      await page.locator("[data-slot=search-results] [data-slot=link-row]").first().waitFor();
      const field = await value(page, "Search links");
      check(field === "economics", `the search field holds "${field}"`);
    },
  },
  {
    name: "/save",
    run: async (page) => {
      await page.goto(`${baseUrl}/save?device=seed-device-phone&url=https://example.com/saved`);
      await page.getByText("Saved ✓").waitFor();
    },
  },
];

const main = async () => {
  const server = await PreviewServer.serve(port);
  const browser = await chromium.launch();
  let failed = 0;
  try {
    for (const walk of walks) {
      const context = await browser.newContext({ reducedMotion: "reduce" });
      const page = await context.newPage();
      const api = Fixtures.connectable(Date.now());
      await open(page, api, walk.signed ?? false);
      try {
        await walk.run(page, api);
        console.log(`✓ ${walk.name}`);
      } catch (error) {
        failed++;
        console.log(`✗ ${walk.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
      await context.close();
    }
  } finally {
    await browser.close();
    if (server?.pid !== undefined) process.kill(-server.pid, "SIGTERM");
  }
  if (failed > 0) {
    console.error(`\n${failed} Connect walk(s) failed`);
    process.exitCode = 1;
  }
};

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
