import * as AtomVue from "@effect/atom-vue";
import * as ApiTesting from "@stash/web-api-client/testing";
import * as PlatformTesting from "@stash/web-platform/testing";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import type * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as Layer from "effect/Layer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as OpenTabsKeys from "../src/open-tabs-keys.ts";
import OpenTabsPage from "../src/open-tabs-page.vue";
import * as Fixtures from "./fixtures.ts";

enableAutoUnmount(afterEach);

const mountPage = async (routes: ApiTesting.Routes) => {
  // Built once, so the test presses keys on the same keyboard the page listens to.
  const keyboard = Layer.build(PlatformTesting.layerKeyboard).pipe(Effect.scoped, Effect.runSync);
  const registry = ApiTesting.makeRegistry(routes, {
    initialValues: [[OpenTabsKeys.layer, Layer.succeedContext(keyboard)]],
  });
  const wrapper = mount(OpenTabsPage, {
    // Toasts and dialogs teleport into <body>, so the page has to be attached to it.
    attachTo: "body",
    global: { provide: { [AtomVue.registryKey]: registry } },
  });
  await flushPromises();
  const press = async (key: string, typing = false) => {
    const taken = Effect.runSync(
      Context.get(keyboard, PlatformTesting.TestKeyboard).press({ key, typing }),
    );
    await flushPromises();
    return taken;
  };
  return { wrapper, press };
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
  wrapper.find("[data-slot=list-row][data-state=selected] [data-slot=open-tab-title]").text();
const chartTicks = (wrapper: Page) => wrapper.findAll("[data-slot=tick]").length;

describe("open-tabs-page", () => {
  it("sorts the tabs into older than 7 days and this week, oldest first", async () => {
    const { wrapper } = await mountPage({ "GET /tabs": () => ApiTesting.json(laptopAndPhone()) });
    expect(sectionTitles(wrapper, "old")).toEqual(["Example d", "Example b"]);
    expect(sectionTitles(wrapper, "week")).toEqual(["Example c", "Example a"]);
    expect(
      wrapper.findAll("[data-section=old] [data-age]").map((age) => age.classes("text-signal")),
    ).toEqual([true, true]);
    expect(wrapper.find("[data-section=old] [data-action=archive-all]").text()).toBe(
      "Archive all 2",
    );
    const link = wrapper.find("[data-slot=open-tab-title]");
    expect(link.attributes()).toMatchObject({
      href: "https://example.com/d",
      target: "_blank",
      rel: "noopener noreferrer",
    });
    expect(chartTicks(wrapper)).toBe(4);
  });

  it("filters rows and chart by device chip, with counts per device", async () => {
    const { wrapper } = await mountPage({ "GET /tabs": () => ApiTesting.json(laptopAndPhone()) });
    const chip = (id: string) => wrapper.find(`[data-slot=toggle-chip][data-device=${id}]`);
    expect(chip("all").text()).toBe("All 4");
    expect(chip("phone").text()).toBe("Device phone 1");
    expect(chip("all").attributes("aria-pressed")).toBe("true");

    await chip("phone").trigger("click");
    expect(chip("phone").attributes("aria-pressed")).toBe("true");
    expect(chip("all").attributes("aria-pressed")).toBe("false");
    expect(titles(wrapper)).toEqual(["Example d"]);
    expect(wrapper.findAll("[data-slot=lane]")).toHaveLength(1);
    expect(chartTicks(wrapper)).toBe(1);

    await chip("all").trigger("click");
    expect(titles(wrapper)).toHaveLength(4);
    expect(chartTicks(wrapper)).toBe(4);
  });

  it("filters by the text in the filter field", async () => {
    const { wrapper } = await mountPage({ "GET /tabs": () => ApiTesting.json(laptopAndPhone()) });
    await wrapper.find("input[type=search]").setValue("example b");
    expect(titles(wrapper)).toEqual(["Example b"]);
    expect(chartTicks(wrapper)).toBe(1);
    expect(wrapper.find("[data-device=laptop]").text()).toBe("Device laptop 1");
    await wrapper.find("input[type=search]").setValue("nothing like it");
    expect(wrapper.find("[data-state=empty]").text()).toContain("No matching tabs");
  });

  it("moves the selection with ↑/↓ and archives the selected tab with E", async () => {
    const archived: Array<unknown> = [];
    const { wrapper, press } = await mountPage({
      "GET /tabs": () => ApiTesting.json(laptopAndPhone()),
      "POST /tabs/archive": (request) => {
        archived.push(body(request));
        return ApiTesting.json(Fixtures.archived("laptop", "https://example.com/b", null), 201);
      },
    });
    expect(await press("ArrowDown")).toBe(true);
    expect(selectedTitle(wrapper)).toBe("Example d");
    await press("ArrowDown");
    await press("ArrowDown");
    await press("ArrowUp");
    expect(selectedTitle(wrapper)).toBe("Example b");
    expect(wrapper.element.ownerDocument.activeElement?.textContent).toBe("Example b");
    expect(wrapper.find("[data-slot=tick][data-selected=true]").exists()).toBe(true);
    expect(wrapper.find("[data-slot=list-row-actions]").text()).toContain("Close on Device laptop");

    // Typing in a field is not a shortcut.
    expect(await press("e", true)).toBe(false);
    expect(await press("e")).toBe(true);
    expect(titles(wrapper)).not.toContain("Example b");
    // The next row takes the selection.
    expect(selectedTitle(wrapper)).toBe("Example c");
    await eventually(() =>
      expect(archived).toEqual([
        { deviceId: "laptop", url: "https://example.com/b", title: "Example b" },
      ]),
    );
    await flushPromises();
    expect(titles(wrapper)).not.toContain("Example b");
  });

  it("closes the selected tab on its device with W", async () => {
    const commands: Array<string | undefined> = [];
    const { wrapper, press } = await mountPage({
      "GET /tabs": () => ApiTesting.json(laptopAndPhone()),
      "POST /devices/:id/commands": (_, { id }) => {
        commands.push(id);
        return ApiTesting.json(Fixtures.command(id ?? "", "https://example.com/d"), 201);
      },
    });
    await press("ArrowDown");
    await press("w");
    expect(titles(wrapper)).not.toContain("Example d");
    await eventually(() => expect(commands).toEqual(["phone"]));
  });

  it("archives from the row action bar", async () => {
    let archived = 0;
    const { wrapper } = await mountPage({
      "GET /tabs": () => ApiTesting.json(laptopAndPhone()),
      "POST /tabs/archive": () => {
        archived++;
        return ApiTesting.json(
          Fixtures.archived("laptop", "https://example.com/a", "Example a"),
          201,
        );
      },
    });
    expect(wrapper.find("[data-action=archive]").exists()).toBe(false);
    // A click on the row (not on its link, which would open the tab) selects it.
    await wrapper.findAll("[data-tab] [data-age]")[3]?.trigger("click");
    expect(selectedTitle(wrapper)).toBe("Example a");
    expect(wrapper.find("[data-action=open]").attributes("href")).toBe("https://example.com/a");
    await wrapper.find("[data-action=archive]").trigger("click");
    expect(titles(wrapper)).not.toContain("Example a");
    await eventually(() => expect(archived).toBe(1));
    await flushPromises();
    expect(titles(wrapper)).not.toContain("Example a");
  });

  it("archives every old tab after a confirm", async () => {
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
    expect(titles(wrapper)).toEqual(["Example c", "Example a"]);
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

  it("shows an empty state without devices, and without tabs", async () => {
    const none = await mountPage({ "GET /tabs": () => ApiTesting.json(Fixtures.allTabs()) });
    expect(none.wrapper.find("[data-state=empty]").text()).toContain("No devices");
    none.wrapper.unmount();
    const empty = await mountPage({
      "GET /tabs": () => ApiTesting.json(Fixtures.allTabs(Fixtures.deviceTabs("laptop", null))),
    });
    expect(empty.wrapper.find("[data-state=empty]").text()).toContain("No open tabs");
  });

  it("shows a skeleton after 200 ms, then an error state with Retry when the tabs can't load", async () => {
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

    it("never shows the skeleton for a response faster than 200 ms", async () => {
      let respond: () => void = () => {};
      const responded = new Promise<void>((resolve) => (respond = resolve));
      const { wrapper } = await mountPage({
        "GET /tabs": () =>
          Effect.promise(() => responded.then(() => ApiTesting.json(laptopAndPhone()))),
      });
      await vi.advanceTimersByTimeAsync(150);
      expect(wrapper.find("[data-state=loading]").exists()).toBe(false);
      respond();
      await eventually(() => expect(titles(wrapper)).toHaveLength(4));
      await vi.advanceTimersByTimeAsync(1000);
      expect(wrapper.find("[data-state=loading]").exists()).toBe(false);
    });
  });
});
