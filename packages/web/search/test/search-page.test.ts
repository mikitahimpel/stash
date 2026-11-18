import * as AtomVue from "@effect/atom-vue";
import * as ApiTesting from "@stash/web-api-client/testing";
import * as RecentSearches from "@stash/web-platform/recent-searches";
import * as PlatformTesting from "@stash/web-platform/testing";
import { DOMWrapper, enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as UrlParams from "effect/http/UrlParams";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as SearchAtoms from "../src/search-atoms.ts";
import SearchPage from "../src/search-page.vue";
import * as Fixtures from "./fixtures.ts";

enableAutoUnmount(afterEach);

let registry: AtomRegistry.AtomRegistry | undefined;
// The recent searches of the page under test, in memory. Tests read and seed them directly.
let recent: RecentSearches.RecentSearches["Service"];

const devices = [
  { id: "device-1", name: "Laptop", kind: "zen", createdAt: "2026-01-01T00:00:00.000Z" },
  { id: "device-2", name: "Phone", kind: "ios", createdAt: "2026-01-01T00:00:00.000Z" },
];

// What every page loads besides the search: the latest links and the devices.
const background = {
  "GET /links": () =>
    ApiTesting.json({
      items: [
        Fixtures.link("s1", { tags: ["rust", "go"], type: "video", sourceDeviceId: "device-1" }),
        Fixtures.link("s2", { tags: ["rust"] }),
      ],
      nextCursor: null,
    }),
  "GET /devices": () => ApiTesting.json(devices),
};

const mountPage = (routes: ApiTesting.Routes, searched: ReadonlyArray<string> = []) => {
  const context = Layer.build(PlatformTesting.layerRecentSearches).pipe(
    Effect.scoped,
    Effect.runSync,
  );
  recent = Context.get(context, RecentSearches.RecentSearches);
  for (const query of searched) Effect.runSync(recent.add(query));
  registry = ApiTesting.makeRegistry(
    { ...background, ...routes },
    { initialValues: [[SearchAtoms.recentLayer, Layer.succeedContext(context)]] },
  );
  return mount(SearchPage, {
    attachTo: "body",
    global: { provide: { [AtomVue.registryKey]: registry } },
  });
};

const remembered = () => Effect.runSync(recent.list).map((entry) => entry.query);

const type = async (wrapper: ReturnType<typeof mountPage>, text: string) => {
  await wrapper.find("input[type=search]").setValue(text);
  await vi.advanceTimersByTimeAsync(SearchAtoms.debounceMillis);
  await flushPromises();
};

const settle = async () => {
  await flushPromises();
  await vi.advanceTimersByTimeAsync(0);
  await flushPromises();
};

const pick = async (wrapper: ReturnType<typeof mountPage>, menu: string, option: string) => {
  const trigger = wrapper
    .findAll("[data-slot=filter-menu]")
    .find((item) => item.text().startsWith(`${menu}:`));
  await trigger?.trigger("keydown", { key: "Enter" });
  await flushPromises();
  const items = new DOMWrapper(wrapper.element.ownerDocument.body).findAll("[role=menuitemradio]");
  await items.find((item) => item.text() === option)?.trigger("click");
  await flushPromises();
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});
afterEach(() => {
  registry?.dispose();
  registry = undefined;
  vi.useRealTimers();
});

describe("SearchPage", () => {
  it("opens on the focused field, with the latest links and no chart", async () => {
    const wrapper = mountPage({});
    await settle();

    const field = wrapper.find<HTMLInputElement>("input[type=search]");
    expect(wrapper.element.ownerDocument.activeElement).toBe(field.element);
    expect(wrapper.find("h1").text()).toBe("Search");
    expect(wrapper.find("svg[role=img]").exists()).toBe(false);
    // The mode only matters once there is a query.
    expect(wrapper.find("[role=radiogroup]").exists()).toBe(false);
    expect(wrapper.findAll("[data-slot=filter-menu]").map((menu) => menu.text())).toEqual([
      "Type: Any",
      "Device: Any",
      "Date: Any",
    ]);
    expect(wrapper.find("[data-slot=recent-searches]").exists()).toBe(false);
    const links = wrapper.find("[data-slot=recent-links]");
    expect(links.find("[data-slot=group-header]").text()).toBe("Recently saved");
    expect(links.findAll("a[data-result-link]").map((link) => link.text())).toEqual([
      "Example article s1",
      "Example article s2",
    ]);
    expect(wrapper.find("ul[aria-label=Results]").exists()).toBe(false);
  });

  it("is just the field and its filters for a first-run user", async () => {
    const wrapper = mountPage({
      "GET /links": () => ApiTesting.json({ items: [], nextCursor: null }),
      "GET /devices": () => ApiTesting.json([]),
    });
    await settle();
    expect(wrapper.find("[data-slot=group-header]").exists()).toBe(false);
    expect(wrapper.find("[data-slot=empty-state]").exists()).toBe(false);
    // No devices: no Device filter.
    expect(wrapper.findAll("[data-slot=filter-menu]").map((menu) => menu.text())).toEqual([
      "Type: Any",
      "Date: Any",
    ]);
  });

  it("narrows the latest links by the filters before anything is typed", async () => {
    const wrapper = mountPage({});
    await settle();
    await pick(wrapper, "Type", "Video");
    expect(
      wrapper.findAll("[data-slot=recent-links] a[data-result-link]").map((link) => link.text()),
    ).toEqual(["Example article s1"]);
  });

  it("lists the recent searches, runs one again and removes one", async () => {
    const searches: Array<string | null> = [];
    const wrapper = mountPage(
      {
        "GET /search": (request) => {
          searches.push(Option.getOrNull(UrlParams.getFirst(request.urlParams, "q")));
          return ApiTesting.json(Fixtures.results("a"));
        },
      },
      ["economics video", "sqlite"],
    );
    await settle();

    const rows = () => wrapper.findAll("[data-slot=recent-searches] li");
    expect(rows().map((row) => row.find("[data-action=search-again]").text())).toEqual([
      "sqlite",
      "economics video",
    ]);

    await rows()[0]?.find("[data-action=forget]").trigger("click");
    await settle();
    expect(rows().map((row) => row.find("[data-action=search-again]").text())).toEqual([
      "economics video",
    ]);
    expect(remembered()).toEqual(["economics video"]);

    await rows()[0]?.find("[data-action=search-again]").trigger("click");
    await vi.advanceTimersByTimeAsync(SearchAtoms.debounceMillis);
    await flushPromises();
    expect(wrapper.find<HTMLInputElement>("input[type=search]").element.value).toBe(
      "economics video",
    );
    expect(searches).toEqual(["economics video"]);
    expect(wrapper.findAll("ul[aria-label=Results] li")).toHaveLength(1);
  });

  it("remembers a search on Enter and on opening a result, not while typing", async () => {
    const wrapper = mountPage({ "GET /search": () => ApiTesting.json(Fixtures.results("a")) });
    await type(wrapper, "rust");
    expect(remembered()).toEqual([]);

    wrapper
      .find("a[data-result-link]")
      .element.addEventListener("click", (event) => event.preventDefault());
    await wrapper.find("a[data-result-link]").trigger("click");
    await settle();
    expect(remembered()).toEqual(["rust"]);

    await type(wrapper, "rust lifetimes");
    await wrapper.find("input[type=search]").trigger("keydown", { key: "Enter" });
    await settle();
    expect(remembered()).toEqual(["rust lifetimes", "rust"]);
  });

  it("clears the query with Escape and goes back to the field", async () => {
    const wrapper = mountPage({ "GET /search": () => ApiTesting.json(Fixtures.results("a")) });
    await type(wrapper, "rust");
    const field = wrapper.find<HTMLInputElement>("input[type=search]");
    await wrapper.find("a[data-result-link]").trigger("keydown", { key: "Escape" });
    await settle();
    expect(field.element.value).toBe("");
    expect(wrapper.element.ownerDocument.activeElement).toBe(field.element);
    expect(wrapper.find("ul[aria-label=Results]").exists()).toBe(false);
  });

  it("shows a loading state once the search has run for 200 ms", async () => {
    const wrapper = mountPage({ "GET /search": () => Effect.never });
    await type(wrapper, "rust");
    expect(wrapper.find("[data-testid=search-loading]").exists()).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(wrapper.find("[data-testid=search-loading]").exists()).toBe(true);
  });

  it("shows the error state when the search fails, and Retry runs it again", async () => {
    let requests = 0;
    const wrapper = mountPage({
      "GET /search": () =>
        ++requests === 1 ? new Response("oops", { status: 500 }) : ApiTesting.json({ hits: [] }),
    });
    await type(wrapper, "rust");
    await vi.waitFor(() => expect(wrapper.find("[data-state=error]").exists()).toBe(true));
    expect(wrapper.find("[data-state=error] h3").text()).toBe("Search failed");
    await wrapper.find("button[data-action=retry]").trigger("click");
    await vi.waitFor(() => expect(wrapper.text()).toContain("No matches"));
    expect(requests).toBe(2);
  });

  it("lists the hits as media rows: preview, host, author, age, device, summary and tags", async () => {
    const wrapper = mountPage({
      "GET /search": () =>
        ApiTesting.json({
          hits: [
            {
              link: Fixtures.link("a", {
                type: "video",
                tags: ["rust", "async", "talk", "long"],
                summary: "A summary",
                imageUrl: "https://example.com/previews/a.jpg",
                author: "Synthetic Channel",
                sourceDeviceId: "device-1",
              }),
              score: 0.9,
            },
            { link: Fixtures.link("b", { status: "seen" }), score: 0.5 },
          ],
        }),
    });
    await type(wrapper, "rust");

    expect(wrapper.find("[data-slot=search-results] [data-slot=group-header]").text()).toBe(
      "Results 2",
    );
    const items = wrapper.findAll("ul[aria-label=Results] li");
    expect(items.map((item) => item.find("a[data-result-link]").text())).toEqual([
      "Example article a",
      "Example article b",
    ]);
    const [first, second] = items;
    expect(first?.find("a[data-result-link]").attributes("href")).toBe(
      "https://example.com/articles/a",
    );
    const image = first!.find("[data-slot=media-thumb] img");
    expect(image.attributes("src")).toBe("https://example.com/previews/a.jpg");
    expect(image.attributes("referrerpolicy")).toBe("no-referrer");
    expect(first?.find("[data-slot=media-thumb-video]").exists()).toBe(true);
    expect(
      first
        ?.find("[data-slot=media-row-meta]")
        .findAll(":scope > *")
        .map((item) => item.text()),
    ).toEqual(["example.com", "Synthetic Channel", expect.stringMatching(/^\d+(mo|y)$/), "Laptop"]);
    expect(first?.find("[data-slot=result-summary]").text()).toBe("A summary");
    expect(first?.findAll("[data-filter=tag]").map((tag) => tag.text())).toEqual([
      "#rust",
      "#async",
      "#talk",
    ]);
    expect(first?.find("[data-slot=more-tags]").text()).toBe("+1");
    expect(first?.find("[data-slot=media-row-unread]").exists()).toBe(true);

    // No image: the generated cover. Seen: no dot. No rank numbers anywhere.
    expect(second?.find("[data-slot=media-thumb]").attributes("data-cover")).toBe("");
    expect(second?.find("[data-slot=media-cover-host]").text()).toBe("example.com");
    expect(second?.find("[data-slot=media-row-unread]").exists()).toBe(false);
    expect(wrapper.find("[data-slot=list-row-leading]").exists()).toBe(false);
  });

  it("highlights the query's terms in keyword and hybrid mode, not in meaning mode", async () => {
    const wrapper = mountPage({
      "GET /search": () =>
        ApiTesting.json({
          hits: [
            {
              link: Fixtures.link("a", {
                title: "Rust for the curious",
                summary: "Быстрый Rust и rust-analyzer",
              }),
              score: 1,
            },
          ],
        }),
    });
    await type(wrapper, "RUST");
    // In the title and in the summary.
    expect(wrapper.findAll("mark").map((mark) => mark.text())).toEqual(["Rust", "Rust", "rust"]);

    await wrapper.find("[role=radio]:nth-child(2)").trigger("click");
    await flushPromises();
    expect(wrapper.find("[role=radio][aria-checked=true]").text()).toBe("Meaning");
    expect(wrapper.findAll("mark")).toEqual([]);
  });

  it("moves through the results with the arrow keys and marks one seen with S", async () => {
    const patches: Array<unknown> = [];
    const wrapper = mountPage({
      "GET /search": () => ApiTesting.json(Fixtures.results("a", "b")),
      "PATCH /links/:id": (request, params) => {
        patches.push([params.id, request.body]);
        return ApiTesting.json(Fixtures.link(params.id ?? "", { status: "seen" }));
      },
    });
    await type(wrapper, "rust");
    const field = wrapper.find("input[type=search]");
    await field.trigger("keydown", { key: "ArrowDown" });
    await flushPromises();
    const links = wrapper.findAll("a[data-result-link]");
    expect(wrapper.element.ownerDocument.activeElement).toBe(links[0]?.element);

    await links[0]?.trigger("keydown", { key: "ArrowDown" });
    await flushPromises();
    expect(wrapper.element.ownerDocument.activeElement).toBe(links[1]?.element);
    expect(wrapper.find("li[data-state=selected]").attributes("data-hit")).toBe("b");

    await links[1]?.trigger("keydown", { key: "s" });
    await flushPromises();
    expect(patches.map((patch) => (patch as Array<unknown>)[0])).toEqual(["b"]);

    await links[1]?.trigger("keydown", { key: "ArrowUp" });
    await links[0]?.trigger("keydown", { key: "ArrowUp" });
    await flushPromises();
    expect(wrapper.element.ownerDocument.activeElement).toBe(field.element);
  });

  it("opens the first result with Enter in the field", async () => {
    const wrapper = mountPage({ "GET /search": () => ApiTesting.json(Fixtures.results("a")) });
    await type(wrapper, "rust");
    const clicks: Array<string> = [];
    wrapper.find("a[data-result-link]").element.addEventListener("click", (event) => {
      event.preventDefault();
      clicks.push((event.currentTarget as HTMLAnchorElement).href);
    });
    await wrapper.find("input[type=search]").trigger("keydown", { key: "Enter" });
    expect(clicks).toEqual(["https://example.com/articles/a"]);
  });

  it("keeps the filters and the mode switch on one row, which scrolls sideways on a phone", async () => {
    const wrapper = mountPage({ "GET /search": () => ApiTesting.json({ hits: [] }) });
    await type(wrapper, "economics");
    const row = wrapper.find("form [data-slot=scroll-row]");
    const filters = row.find("[role=group][aria-label=Filters]");
    expect(filters.findAll("button").length).toBeGreaterThanOrEqual(3);
    expect(row.find("[role=radiogroup]").exists()).toBe(true);
    // Neither the row nor the filter group wraps below `sm`.
    expect(row.classes()).toContain("max-sm:overflow-x-auto");
    expect(row.classes()).not.toContain("flex-wrap");
    expect(filters.classes()).not.toContain("flex-wrap");
    expect(filters.classes()).toContain("sm:flex-wrap");
  });

  it("says so when nothing matches", async () => {
    const wrapper = mountPage({ "GET /search": () => ApiTesting.json({ hits: [] }) });
    await type(wrapper, "nothing like this");
    expect(wrapper.text()).toContain("No matches");
  });

  it("searches again with the type, device and date filters", async () => {
    const queries: Array<Record<string, unknown>> = [];
    const wrapper = mountPage({
      "GET /search": (request) => {
        queries.push(UrlParams.toRecord(request.urlParams));
        return ApiTesting.json(Fixtures.results("a"));
      },
    });
    await type(wrapper, "rust");
    await pick(wrapper, "Type", "Video");
    await pick(wrapper, "Device", "Phone");
    await pick(wrapper, "Date", "Past week");
    expect(queries.map(({ type, deviceId }) => ({ type, deviceId }))).toEqual([
      {},
      { type: "video" },
      { type: "video", deviceId: "device-2" },
      { type: "video", deviceId: "device-2" },
    ]);
    expect(queries.at(-1)?.["since"]).toMatch(/^\d{4}-\d\d-\d\dT\d\d:00:00\.000Z$/);
    expect(queries[2]?.["since"]).toBeUndefined();
    expect(wrapper.findAll("[data-slot=filter-menu]").map((menu) => menu.text())).toEqual([
      "Type: Video",
      "Device: Phone",
      "Date: Past week",
    ]);
  });

  it("has no tag chips in the filters; a tag on a row filters by it, and its chip clears it", async () => {
    const tags: Array<string | null> = [];
    const wrapper = mountPage({
      "GET /search": (request) => {
        tags.push(Option.getOrNull(UrlParams.getFirst(request.urlParams, "tag")));
        return ApiTesting.json({
          hits: [{ link: Fixtures.link("a", { tags: ["go", "rust"] }), score: 1 }],
        });
      },
    });
    await type(wrapper, "rust");
    expect(wrapper.find("[role=group][aria-label=Filters] [data-slot=toggle-chip]").exists()).toBe(
      false,
    );

    await wrapper.find("[data-filter=tag]").trigger("click");
    await settle();
    expect(tags).toEqual([null, "go"]);
    const chip = wrapper.find("[data-clear=tag]");
    expect(chip.text()).toContain("#go");

    await chip.trigger("click");
    await settle();
    expect(wrapper.find("[data-clear=tag]").exists()).toBe(false);
  });
});
