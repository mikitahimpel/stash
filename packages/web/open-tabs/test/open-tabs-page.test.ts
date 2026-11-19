import * as AtomVue from "@effect/atom-vue";
import * as Clipboard from "@effect/platform-browser/Clipboard";
import * as ApiTesting from "@stash/web-api-client/testing";
import * as PlatformTesting from "@stash/web-platform/testing";
import { enableAutoUnmount, flushPromises, mount, RouterLinkStub } from "@vue/test-utils";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import type * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as Layer from "effect/Layer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as OpenTabsAtoms from "../src/open-tabs-atoms.ts";
import * as OpenTabsKeys from "../src/open-tabs-keys.ts";
import OpenTabsPage from "../src/open-tabs-page.vue";
import * as Fixtures from "./fixtures.ts";

enableAutoUnmount(afterEach);

const mountPage = async (routes: ApiTesting.Routes) => {
  // Built once, so the test presses keys on the same keyboard the page listens to.
  const keyboard = Layer.build(PlatformTesting.layerKeyboard).pipe(Effect.scoped, Effect.runSync);
  const clipboard = Layer.build(PlatformTesting.layerClipboard).pipe(Effect.scoped, Effect.runSync);
  const registry = ApiTesting.makeRegistry(
    // No saved links unless the test says so.
    { "GET /links": () => ApiTesting.json(Fixtures.linksPage()), ...routes },
    {
      initialValues: [
        [OpenTabsKeys.layer, Layer.succeedContext(keyboard)],
        [OpenTabsAtoms.clipboard, Layer.succeedContext(clipboard)],
      ],
    },
  );
  const wrapper = mount(OpenTabsPage, {
    // Toasts and dialogs teleport into <body>, so the page has to be attached to it.
    attachTo: "body",
    // The page links to Settings and to saved links; it is mounted without a router.
    global: { provide: { [AtomVue.registryKey]: registry }, stubs: { RouterLink: RouterLinkStub } },
  });
  await flushPromises();
  const press = async (key: string, typing = false) => {
    const taken = Effect.runSync(
      Context.get(keyboard, PlatformTesting.TestKeyboard).press({ key, typing }),
    );
    await flushPromises();
    return taken;
  };
  const copied = () =>
    Effect.runPromise(
      Effect.provide(
        Effect.flatMap(Clipboard.Clipboard, (service) => service.readString),
        clipboard,
      ),
    );
  return { wrapper, press, copied };
};

/** Retries `check` until it passes: the stub api answers asynchronously. */
const eventually = (check: () => void) =>
  vi.waitFor(async () => {
    await flushPromises();
    check();
  });

const body = (request: HttpClientRequest.HttpClientRequest): unknown =>
  request.body._tag === "Uint8Array"
    ? JSON.parse(new TextDecoder().decode(request.body.body))
    : undefined;

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

// Ages count from the real clock, so the tabs open relative to now.
const laptopAndPhone = () =>
  Fixtures.allTabs(
    Fixtures.deviceTabs("laptop", [
      Fixtures.tab("a", daysAgo(1 / 24)),
      Fixtures.tab("b", daysAgo(9)),
      Fixtures.tab("c", daysAgo(3)),
    ]),
    Fixtures.deviceTabs("phone", [Fixtures.tab("d", daysAgo(10))]),
  );

type Page = Awaited<ReturnType<typeof mountPage>>["wrapper"];

const titles = (wrapper: Page) =>
  wrapper.findAll("[data-slot=open-tab-title]").map((link) => link.text());
const sectionTitles = (wrapper: Page, id: string) =>
  wrapper.findAll(`[data-section=${id}] [data-slot=open-tab-title]`).map((link) => link.text());
const selectedTitle = (wrapper: Page) =>
  wrapper.find("[data-state=selected] [data-slot=open-tab-title]").text();
const row = (wrapper: Page, title: string) => {
  const found = wrapper
    .findAll("[data-tab]")
    .find((item) => item.find("[data-slot=open-tab-title]").text() === title);
  if (found === undefined) throw new Error(`no row "${title}"`);
  return found;
};
/** The rows whose actions are out (selected, or swiped). */
const withActions = (wrapper: Page) =>
  wrapper
    .findAll("[data-tab]")
    .filter((item) => item.find("[data-slot=compact-row-actions]").classes("flex"))
    .map((item) => item.find("[data-slot=open-tab-title]").text());

describe("open-tabs-page", () => {
  it("groups the tabs by device, then the stale ones of every device, oldest first", async () => {
    const { wrapper } = await mountPage({ "GET /tabs": () => ApiTesting.json(laptopAndPhone()) });
    expect(sectionTitles(wrapper, "laptop")).toEqual(["Example a", "Example c"]);
    expect(sectionTitles(wrapper, "stale")).toEqual(["Example d", "Example b"]);
    // The phone has only a stale tab: no group of its own.
    expect(wrapper.find("[data-section=phone]").exists()).toBe(false);
    // The fixture's snapshot is from a fixed day, so only the start of the remark is checked.
    expect(wrapper.find("[data-section=laptop] [data-slot=group-header]").text()).toMatch(
      /^Zen on Device laptop2 tabssynced \d+ d ago$/,
    );
    expect(wrapper.find("[data-section=stale] [data-slot=group-header]").text()).toContain(
      "Stale2 tabsopen longer than 7 days",
    );
    expect(wrapper.find("[data-slot=page-header-subtitle]").text()).toBe(
      "4 tabs open · 2 older than a week",
    );
    expect(wrapper.find("[data-section=stale] [data-action=archive-all]").text()).toBe(
      "Archive all 2",
    );
  });

  it("shows a tab as its icon, title, host and how long it has been open: no address line", async () => {
    const { wrapper } = await mountPage({
      "GET /tabs": () =>
        ApiTesting.json(
          Fixtures.allTabs(
            Fixtures.deviceTabs("laptop", [
              Fixtures.tab("a", daysAgo(3.2)),
              { ...Fixtures.tab("b", null), title: null },
            ]),
          ),
        ),
    });
    const first = row(wrapper, "Example a");
    expect(first.find("[data-slot=open-tab-title]").attributes()).toMatchObject({
      href: "https://example.com/a",
      target: "_blank",
      rel: "noopener noreferrer",
      // The whole address is the tooltip.
      title: "https://example.com/a",
    });
    expect(first.find("[data-slot=compact-row-meta]").text()).toBe("example.comopen 3 d");
    expect(first.text()).not.toContain("https://");
    // The sync time is not the tab's: a tab the browser gave no time for says nothing of it.
    const second = row(wrapper, "https://example.com/b");
    expect(second.find("[data-slot=compact-row-meta]").text()).toBe("example.com");
    // Among the tabs of one device a row does not repeat the device.
    expect(wrapper.text()).not.toContain("Device laptop ·");

    const icon = first.find("img[data-slot=site-icon]");
    expect(icon.attributes()).toMatchObject({
      src: "https://example.com/favicon.ico",
      loading: "lazy",
      referrerpolicy: "no-referrer",
    });
    await icon.trigger("error");
    expect(first.find("img").exists()).toBe(false);
    expect(first.find("[data-slot=site-icon][data-initial]").text()).toBe("e");
  });

  it("names the device on a stale tab", async () => {
    const { wrapper } = await mountPage({ "GET /tabs": () => ApiTesting.json(laptopAndPhone()) });
    expect(row(wrapper, "Example d").find("[data-slot=compact-row-meta]").text()).toBe(
      "example.comDevice phoneopen 10 d",
    );
  });

  it("marks the tabs that are saved, with the link's preview, and offers no Save for them", async () => {
    const { wrapper } = await mountPage({
      "GET /tabs": () => ApiTesting.json(laptopAndPhone()),
      "GET /links": () =>
        ApiTesting.json(
          Fixtures.linksPage(
            Fixtures.link("link-a", "https://example.com/a", {
              imageUrl: "https://example.com/previews/a.svg",
            }),
            Fixtures.link("link-c", "https://example.com/c"),
          ),
        ),
    });
    await eventually(() => expect(wrapper.findAll("[data-saved]")).toHaveLength(2));
    const saved = row(wrapper, "Example a");
    expect(saved.find("[data-slot=open-tab-saved]").text()).toBe("Saved");
    expect(saved.findComponent(RouterLinkStub).props("to")).toEqual({
      name: "link-details",
      params: { id: "link-a" },
    });
    expect(saved.find("[data-slot=compact-row-thumb] img").attributes("src")).toBe(
      "https://example.com/previews/a.svg",
    );
    expect(saved.find("[data-action=save]").exists()).toBe(false);
    // Saved without an image: the mark alone, in a row of the same kind.
    expect(row(wrapper, "Example c").find("[data-slot=compact-row-thumb]").exists()).toBe(false);
    expect(row(wrapper, "Example b").find("[data-slot=open-tab-saved]").exists()).toBe(false);
    expect(row(wrapper, "Example b").find("[data-action=save]").exists()).toBe(true);
  });

  it("filters by the text in the filter field", async () => {
    const { wrapper } = await mountPage({ "GET /tabs": () => ApiTesting.json(laptopAndPhone()) });
    await wrapper.find("input[type=search]").setValue("example b");
    expect(titles(wrapper)).toEqual(["Example b"]);
    // The line under the title counts every tab, not the filtered ones.
    expect(wrapper.find("[data-slot=page-header-subtitle]").text()).toContain("4 tabs open");
    await wrapper.find("input[type=search]").setValue("nothing like it");
    expect(wrapper.find("[data-state=empty]").text()).toContain("No matching tabs");
    await wrapper.find("[data-action=clear-filter]").trigger("click");
    expect(titles(wrapper)).toHaveLength(4);
  });

  it("folds a group from its header", async () => {
    const { wrapper, press } = await mountPage({
      "GET /tabs": () => ApiTesting.json(laptopAndPhone()),
    });
    const toggle = () => wrapper.find("[data-section=laptop] [data-slot=group-header-toggle]");
    expect(toggle().attributes("aria-expanded")).toBe("true");
    await toggle().trigger("click");
    expect(toggle().attributes("aria-expanded")).toBe("false");
    expect(titles(wrapper)).toEqual(["Example d", "Example b"]);
    // The header stays, with its count; the arrow keys skip the folded rows.
    expect(wrapper.find("[data-section=laptop] [data-slot=group-header]").text()).toContain(
      "2 tabs",
    );
    await press("ArrowDown");
    expect(selectedTitle(wrapper)).toBe("Example d");
    await toggle().trigger("click");
    expect(titles(wrapper)).toHaveLength(4);
  });

  it("moves the selection with ↑/↓ and archives the selected tab with E", async () => {
    const archived: Array<unknown> = [];
    const { wrapper, press } = await mountPage({
      "GET /tabs": () => ApiTesting.json(laptopAndPhone()),
      "POST /tabs/archive": (request) => {
        archived.push(body(request));
        return ApiTesting.json(Fixtures.archived("laptop", "https://example.com/c", null), 201);
      },
    });
    expect(withActions(wrapper)).toEqual([]);
    expect(await press("ArrowDown")).toBe(true);
    expect(selectedTitle(wrapper)).toBe("Example a");
    await press("ArrowDown");
    await press("ArrowDown");
    await press("ArrowUp");
    expect(selectedTitle(wrapper)).toBe("Example c");
    expect(wrapper.element.ownerDocument.activeElement?.textContent).toBe("Example c");
    // The selected row has its actions out.
    expect(withActions(wrapper)).toEqual(["Example c"]);

    // Typing in a field is not a shortcut.
    expect(await press("e", true)).toBe(false);
    expect(await press("e")).toBe(true);
    expect(titles(wrapper)).not.toContain("Example c");
    // The next row takes the selection.
    expect(selectedTitle(wrapper)).toBe("Example d");
    await eventually(() =>
      expect(archived).toEqual([
        { deviceId: "laptop", url: "https://example.com/c", title: "Example c" },
      ]),
    );
    await flushPromises();
    expect(titles(wrapper)).not.toContain("Example c");
  });

  it("closes the selected tab on its device with W", async () => {
    const commands: Array<string | undefined> = [];
    const { wrapper, press } = await mountPage({
      "GET /tabs": () => ApiTesting.json(laptopAndPhone()),
      "POST /devices/:id/commands": (_, { id }) => {
        commands.push(id);
        return ApiTesting.json(Fixtures.command(id ?? "", "https://example.com/a"), 201);
      },
    });
    await press("ArrowDown");
    await press("w");
    expect(titles(wrapper)).not.toContain("Example a");
    await eventually(() => expect(commands).toEqual(["laptop"]));
  });

  it("saves a tab from its row: it stays open and says Saved", async () => {
    const saved: Array<unknown> = [];
    const { wrapper } = await mountPage({
      "GET /tabs": () => ApiTesting.json(laptopAndPhone()),
      "POST /links": (request) => {
        saved.push(body(request));
        return ApiTesting.json(
          { ...Fixtures.link("link-c", "https://example.com/c"), created: true },
          201,
        );
      },
    });
    // A click on the row (not on its link, which would open the tab) selects it.
    await row(wrapper, "Example c").find("[data-slot=compact-row-meta]").trigger("click");
    expect(selectedTitle(wrapper)).toBe("Example c");
    const actions = row(wrapper, "Example c");
    expect(actions.find("[data-action=open]").attributes("href")).toBe("https://example.com/c");
    await actions.find("[data-action=save]").trigger("click");
    await eventually(() =>
      expect(row(wrapper, "Example c").find("[data-slot=open-tab-saved]").exists()).toBe(true),
    );
    expect(saved).toEqual([
      { url: "https://example.com/c", title: "Example c", deviceId: "laptop" },
    ]);
    expect(titles(wrapper)).toHaveLength(4);
  });

  it("saves the selected tab with S and copies its address with C", async () => {
    let saved = 0;
    const { wrapper, press, copied } = await mountPage({
      "GET /tabs": () => ApiTesting.json(laptopAndPhone()),
      "POST /links": () => {
        saved++;
        return ApiTesting.json(
          { ...Fixtures.link("link-a", "https://example.com/a"), created: true },
          201,
        );
      },
    });
    await press("ArrowDown");
    expect(await press("c")).toBe(true);
    await eventually(async () => expect(await copied()).toBe("https://example.com/a"));
    await eventually(() =>
      expect(wrapper.element.ownerDocument.body.textContent).toContain("Link copied"),
    );
    await press("s");
    await eventually(() => expect(saved).toBe(1));
  });

  it("copies a tab's address from its row", async () => {
    const { wrapper, copied } = await mountPage({
      "GET /tabs": () => ApiTesting.json(laptopAndPhone()),
    });
    await row(wrapper, "Example b").find("[data-action=copy]").trigger("click");
    await eventually(async () => expect(await copied()).toBe("https://example.com/b"));
  });

  it("brings a row's actions out on a swipe to the left, one row at a time", async () => {
    const { wrapper } = await mountPage({ "GET /tabs": () => ApiTesting.json(laptopAndPhone()) });
    const swipe = async (title: string, from: number, to: number) => {
      const item = row(wrapper, title);
      await item.trigger("pointerdown", { pointerType: "touch", clientX: from, clientY: 100 });
      await item.trigger("pointermove", { pointerType: "touch", clientX: to, clientY: 104 });
      await item.trigger("pointerup", { pointerType: "touch", clientX: to, clientY: 104 });
    };
    await swipe("Example a", 300, 240);
    expect(withActions(wrapper)).toEqual(["Example a"]);
    await swipe("Example c", 300, 240);
    expect(withActions(wrapper)).toEqual(["Example c"]);
    await swipe("Example c", 240, 300);
    expect(withActions(wrapper)).toEqual([]);
    // A scroll is not a swipe.
    const item = row(wrapper, "Example a");
    await item.trigger("pointerdown", { pointerType: "touch", clientX: 300, clientY: 100 });
    await item.trigger("pointermove", { pointerType: "touch", clientX: 250, clientY: 200 });
    expect(withActions(wrapper)).toEqual([]);
  });

  it("picks several tabs and saves them in one request", async () => {
    const sent: Array<unknown> = [];
    const { wrapper, press } = await mountPage({
      "GET /tabs": () => ApiTesting.json(laptopAndPhone()),
      "POST /links/batch": (request) => {
        sent.push(body(request));
        return ApiTesting.json(
          {
            links: [
              Fixtures.link("link-a", "https://example.com/a"),
              Fixtures.link("link-d", "https://example.com/d"),
            ],
          },
          201,
        );
      },
    });
    expect(wrapper.find("[role=checkbox]").exists()).toBe(false);
    await wrapper.find("[data-action=pick]").trigger("click");
    expect(wrapper.findAll("[role=checkbox]")).toHaveLength(4);
    // While picking, the rows have no actions of their own and a click anywhere picks.
    expect(wrapper.find("[data-action=save]").exists()).toBe(false);
    await row(wrapper, "Example a").find("[role=checkbox]").trigger("click");
    await row(wrapper, "Example d").find("[data-slot=compact-row-meta]").trigger("click");
    expect(wrapper.find("[data-slot=picked-count]").text()).toBe("2 selected");
    expect(wrapper.findAll("[role=checkbox]").map((box) => box.attributes("aria-checked"))).toEqual(
      ["true", "false", "true", "false"],
    );

    await wrapper.find("[data-action=save-picked]").trigger("click");
    await eventually(() => expect(wrapper.findAll("[data-saved]")).toHaveLength(2));
    expect(sent).toEqual([
      {
        links: [
          { url: "https://example.com/a", title: "Example a", deviceId: "laptop" },
          { url: "https://example.com/d", title: "Example d", deviceId: "phone" },
        ],
      },
    ]);
    // Saving ends the picking.
    expect(wrapper.find("[role=checkbox]").exists()).toBe(false);

    // X picks the keyboard's row; Done leaves without doing anything.
    await press("ArrowDown");
    await press("x");
    expect(wrapper.find("[data-slot=picked-count]").text()).toBe("1 selected");
    await wrapper.find("[data-action=done-picking]").trigger("click");
    expect(wrapper.find("[role=checkbox]").exists()).toBe(false);
    expect(sent).toHaveLength(1);
  });

  describe("a held finger", () => {
    beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));
    afterEach(() => vi.useRealTimers());

    it("starts picking with that row", async () => {
      const { wrapper } = await mountPage({
        "GET /tabs": () => ApiTesting.json(laptopAndPhone()),
      });
      await row(wrapper, "Example c").trigger("pointerdown", {
        pointerType: "touch",
        clientX: 100,
        clientY: 100,
      });
      await vi.advanceTimersByTimeAsync(600);
      await flushPromises();
      expect(wrapper.find("[data-slot=picked-count]").text()).toBe("1 selected");
      expect(row(wrapper, "Example c").find("[role=checkbox]").attributes("aria-checked")).toBe(
        "true",
      );
    });
  });

  it("saves every stale tab at once", async () => {
    const sent: Array<{ links: Array<{ url: string }> }> = [];
    const { wrapper } = await mountPage({
      "GET /tabs": () => ApiTesting.json(laptopAndPhone()),
      "POST /links/batch": (request) => {
        sent.push(body(request) as { links: Array<{ url: string }> });
        return ApiTesting.json(
          {
            links: [
              Fixtures.link("link-d", "https://example.com/d"),
              Fixtures.link("link-b", "https://example.com/b"),
            ],
          },
          201,
        );
      },
    });
    await wrapper.find("[data-section=stale] [data-action=save-stale]").trigger("click");
    await eventually(() =>
      expect(wrapper.findAll("[data-section=stale] [data-saved]")).toHaveLength(2),
    );
    expect(sent.map((batch) => batch.links.map((link) => link.url))).toEqual([
      ["https://example.com/d", "https://example.com/b"],
    ]);
    // Nothing left to save: the action goes, the tabs stay open.
    expect(wrapper.find("[data-action=save-stale]").exists()).toBe(false);
    expect(titles(wrapper)).toHaveLength(4);
  });

  it("archives every stale tab after a confirm", async () => {
    const archived: Array<string> = [];
    const { wrapper, press } = await mountPage({
      "GET /tabs": () => ApiTesting.json(laptopAndPhone()),
      "POST /tabs/archive": (request) => {
        const payload = body(request) as { url: string };
        archived.push(payload.url);
        return ApiTesting.json(Fixtures.archived("laptop", payload.url, null), 201);
      },
    });
    await wrapper.find("[data-action=archive-all]").trigger("click");
    await flushPromises();
    const page = wrapper.element.ownerDocument.body;
    expect(page.textContent).toContain("Archive 2 tabs?");
    // Shortcuts are off while the dialog is open.
    expect(await press("ArrowDown")).toBe(false);
    const confirm = page.querySelector(
      "[data-action=confirm-archive-all]",
    ) as HTMLButtonElement | null;
    confirm?.click();
    await flushPromises();
    expect(titles(wrapper)).toEqual(["Example a", "Example c"]);
    await eventually(() =>
      expect(archived.toSorted()).toEqual(["https://example.com/b", "https://example.com/d"]),
    );
  });

  it("brings a tab back and shows a toast when closing it fails", async () => {
    let respond: () => void = () => {};
    const responded = new Promise<void>((resolve) => (respond = resolve));
    const { wrapper, press } = await mountPage({
      "GET /tabs": () => ApiTesting.json(laptopAndPhone()),
      "POST /devices/:id/commands": (_, { id }) =>
        Effect.promise(() =>
          responded.then(() => ApiTesting.json({ _tag: "NotFound", resource: "device", id }, 404)),
        ),
    });
    await press("ArrowDown");
    await press("w");
    expect(titles(wrapper)).toHaveLength(3);
    respond();
    await eventually(() => expect(titles(wrapper)).toHaveLength(4));
    // The toast is teleported to <body>, outside the wrapper.
    await eventually(() =>
      expect(wrapper.element.ownerDocument.body.textContent).toContain("Couldn't close the tab"),
    );
  });

  it("offers the devices without any, and shows an empty state without tabs", async () => {
    const none = await mountPage({ "GET /tabs": () => ApiTesting.json(Fixtures.allTabs()) });
    const card = none.wrapper.find("[data-slot=start-saving]");
    expect(card.find("h2").text()).toBe("Connect a device");
    expect(card.findAll("li").map((row) => row.find("span").text())).toEqual([
      "Zen extension",
      "iPhone",
    ]);
    // One action per kind of device. The header is the one the page had while loading: Add
    // device stays, and the counts' line keeps its place, empty.
    expect(card.findAll("li").map((row) => row.find("a").text())).toEqual(["Add Zen", "Add Mac"]);
    expect(none.wrapper.find("[data-slot=page-header-actions]").text()).toBe("Add device");
    expect(none.wrapper.find("[data-slot=page-header-subtitle]").text()).toBe("");
    none.wrapper.unmount();
    const empty = await mountPage({
      "GET /tabs": () => ApiTesting.json(Fixtures.allTabs(Fixtures.deviceTabs("laptop", null))),
    });
    expect(empty.wrapper.find("[data-state=empty]").text()).toContain("No open tabs");
    expect(empty.wrapper.find("[data-slot=page-header-subtitle]").text()).toBe("");
  });

  it("has Add device as its one primary action", async () => {
    const { wrapper } = await mountPage({ "GET /tabs": () => ApiTesting.json(laptopAndPhone()) });
    const header = wrapper.find("[data-slot=page-header-actions]");
    expect(header.text()).toBe("Add device");
    expect(wrapper.findAll(".tactile-primary").map((el) => el.text())).toEqual(["Add device"]);
  });

  it("shows a skeleton after 150 ms, then an error state with Retry when the tabs can't load", async () => {
    let respond: () => void = () => {};
    let responded = new Promise<void>((resolve) => (respond = resolve));
    let requests = 0;
    const { wrapper } = await mountPage({
      "GET /tabs": () => {
        requests++;
        return Effect.promise(() =>
          responded.then(() =>
            requests === 1
              ? new Response("oops", { status: 500 })
              : ApiTesting.json(laptopAndPhone()),
          ),
        );
      },
    });
    expect(wrapper.find("[data-state=loading]").exists()).toBe(false);
    await eventually(() => expect(wrapper.find("[data-state=loading]").exists()).toBe(true));
    respond();
    await eventually(() => expect(wrapper.find("[data-state=error]").exists()).toBe(true));
    expect(wrapper.find("[data-state=error] h3").text()).toBe("Couldn't load open tabs");

    responded = Promise.resolve();
    await wrapper.find("[data-state=error] button[data-action=retry]").trigger("click");
    await eventually(() => expect(titles(wrapper)).toHaveLength(4));
    expect(requests).toBe(2);
  });

  describe("with fake timers", () => {
    beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));
    afterEach(() => vi.useRealTimers());

    it("never shows the skeleton for a response faster than 150 ms", async () => {
      let respond: () => void = () => {};
      const responded = new Promise<void>((resolve) => (respond = resolve));
      const { wrapper } = await mountPage({
        "GET /tabs": () =>
          Effect.promise(() => responded.then(() => ApiTesting.json(laptopAndPhone()))),
      });
      await vi.advanceTimersByTimeAsync(140);
      expect(wrapper.find("[data-state=loading]").exists()).toBe(false);
      respond();
      await eventually(() => expect(titles(wrapper)).toHaveLength(4));
      await vi.advanceTimersByTimeAsync(1000);
      expect(wrapper.find("[data-state=loading]").exists()).toBe(false);
    });
  });
});
