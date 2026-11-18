import * as AtomVue from "@effect/atom-vue";
import * as ApiTesting from "@stash/web-api-client/testing";
import * as RecentSearches from "@stash/web-platform/recent-searches";
import * as PlatformTesting from "@stash/web-platform/testing";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { routes } from "../src/routes.ts";
import * as SearchAtoms from "../src/search-atoms.ts";
import SearchBox from "../src/search-box.vue";

enableAutoUnmount(afterEach);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});
afterEach(() => {
  vi.useRealTimers();
});

const page = { render: () => null };

// The field on the app's routes: the Inbox, which shows the results, and one other page.
const mountBox = async (path: string, searched: ReadonlyArray<string> = []) => {
  const context = Layer.build(PlatformTesting.layerRecentSearches).pipe(
    Effect.scoped,
    Effect.runSync,
  );
  const recent = Context.get(context, RecentSearches.RecentSearches);
  for (const query of searched) Effect.runSync(recent.add(query));
  const registry = ApiTesting.makeRegistry(
    {},
    { initialValues: [[SearchAtoms.recentLayer, Layer.succeedContext(context)]] },
  );
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/links", name: "links", component: page },
      { path: "/settings", name: "settings", component: page },
      ...routes,
    ],
  });
  await router.push(path);
  const wrapper = mount(SearchBox, {
    attachTo: "body",
    global: { plugins: [router], provide: { [AtomVue.registryKey]: registry } },
  });
  await flushPromises();
  const input = wrapper.find<HTMLInputElement>("input[type=search]");
  const url = () => router.currentRoute.value.fullPath;
  const remembered = () => Effect.runSync(recent.list).map((entry) => entry.query);
  const suggestions = () => wrapper.findAll("[data-recent]").map((item) => item.text());
  /** Types `text` and waits for the pause that sends it. */
  const type = async (text: string) => {
    await input.setValue(text);
    await vi.advanceTimersByTimeAsync(SearchAtoms.debounceMillis);
    await flushPromises();
  };
  const key = async (name: string) => {
    await input.trigger("keydown", { key: name });
    await flushPromises();
  };
  return { wrapper, router, input, url, remembered, suggestions, type, key };
};

describe("SearchBox", () => {
  it("is one labelled search field, whatever the page", async () => {
    const { wrapper, input } = await mountBox("/settings");
    expect(wrapper.find("form[role=search]").exists()).toBe(true);
    expect(wrapper.findAll("input")).toHaveLength(1);
    expect(input.attributes("aria-label")).toBe("Search links");
    expect(input.element.value).toBe("");
  });

  it("puts the query in the Inbox's URL once typing pauses, and only the last one", async () => {
    const { input, url } = await mountBox("/links?feed=all");
    for (const text of ["r", "ru", "rus", "rust"]) {
      await input.setValue(text);
      await vi.advanceTimersByTimeAsync(SearchAtoms.debounceMillis - 50);
    }
    expect(url()).toBe("/links?feed=all");
    await vi.advanceTimersByTimeAsync(50);
    await flushPromises();
    expect(url()).toBe("/links?feed=all&q=rust");
  });

  it("opens the Inbox with the query when typed on another page", async () => {
    const { url, type, input } = await mountBox("/settings?guide=mac");
    await type("economics");
    expect(url()).toBe("/links?q=economics");
    expect(input.element.value).toBe("economics");
  });

  it("shows the query of the URL it was opened with", async () => {
    const { input } = await mountBox("/links?q=sqlite%20fts&mode=keyword");
    expect(input.element.value).toBe("sqlite fts");
  });

  it("takes /search?q=… to the Inbox with its query", async () => {
    const { input, url } = await mountBox("/search?q=rust");
    expect(url()).toBe("/links?q=rust");
    expect(input.element.value).toBe("rust");
  });

  it("gives the Inbox its URL back when the field is cleared, keeping its filters", async () => {
    const { url, type } = await mountBox("/links?type=video&q=rust&mode=keyword&range=week");
    await type("");
    expect(url()).toBe("/links?type=video");
  });

  it("clears the search and leaves the field on Escape", async () => {
    const { input, url, key } = await mountBox("/links?q=rust");
    input.element.focus();
    await key("Escape");
    expect(input.element.value).toBe("");
    expect(url()).toBe("/links");
    expect(input.element.ownerDocument.activeElement).not.toBe(input.element);
  });

  it("makes a search one history entry: back returns to where it started", async () => {
    const { router, input, url, type } = await mountBox("/settings");
    await type("ru");
    await type("rust");
    expect(url()).toBe("/links?q=rust");
    router.back();
    await flushPromises();
    await vi.advanceTimersByTimeAsync(0);
    await flushPromises();
    expect(url()).toBe("/settings");
    expect(input.element.value).toBe("");
    router.forward();
    await flushPromises();
    await vi.advanceTimersByTimeAsync(0);
    await flushPromises();
    expect(url()).toBe("/links?q=rust");
    expect(input.element.value).toBe("rust");
  });

  it("sends the query at once on Enter, remembers it and leaves the field", async () => {
    const { input, url, key, remembered } = await mountBox("/links");
    input.element.focus();
    await input.setValue("rust async");
    await key("Enter");
    expect(url()).toBe("/links?q=rust+async");
    expect(remembered()).toEqual(["rust async"]);
    expect(input.element.ownerDocument.activeElement).not.toBe(input.element);
  });

  it("does not remember what was only typed", async () => {
    const { type, remembered } = await mountBox("/links");
    await type("rust");
    expect(remembered()).toEqual([]);
  });

  it("offers the recent searches under the focused, empty field", async () => {
    const { wrapper, input, suggestions, type } = await mountBox("/links", ["rust", "economics"]);
    expect(suggestions()).toEqual([]);
    await input.trigger("focus");
    await flushPromises();
    expect(suggestions()).toEqual(["economics", "rust"]);
    expect(wrapper.find("[data-slot=field-popup-panel]").attributes("aria-label")).toBe(
      "Recent searches",
    );
    await type("r");
    expect(suggestions()).toEqual([]);
    await input.setValue("");
    expect(suggestions()).toEqual(["economics", "rust"]);
    await input.trigger("blur");
    expect(suggestions()).toEqual([]);
  });

  it("runs a recent search again at once", async () => {
    const { wrapper, input, url, remembered } = await mountBox("/settings", ["rust", "economics"]);
    await input.trigger("focus");
    await flushPromises();
    await wrapper.find("[data-recent=rust] [data-slot=field-popup-pick]").trigger("click");
    await flushPromises();
    expect(url()).toBe("/links?q=rust");
    expect(input.element.value).toBe("rust");
    expect(remembered()).toEqual(["rust", "economics"]);
  });

  it("picks a recent search with the arrow keys and Enter", async () => {
    const { wrapper, input, url, key } = await mountBox("/links", ["rust", "economics"]);
    await input.trigger("focus");
    await flushPromises();
    await key("ArrowDown");
    await key("ArrowDown");
    expect(wrapper.find("[data-active]").attributes("data-recent")).toBe("rust");
    await key("ArrowUp");
    expect(wrapper.find("[data-active]").attributes("data-recent")).toBe("economics");
    await key("Enter");
    expect(url()).toBe("/links?q=economics");
  });

  it("removes a recent search from the list", async () => {
    const { wrapper, input, suggestions, remembered } = await mountBox("/links", [
      "rust",
      "economics",
    ]);
    await input.trigger("focus");
    await flushPromises();
    await wrapper.find("[data-recent=economics] [data-action=forget]").trigger("click");
    await flushPromises();
    await vi.advanceTimersByTimeAsync(0);
    await flushPromises();
    expect(remembered()).toEqual(["rust"]);
    expect(suggestions()).toEqual(["rust"]);
  });
});
