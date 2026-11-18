import { DOMWrapper, enableAutoUnmount, type VueWrapper } from "@vue/test-utils";
import * as ApiTesting from "@stash/web-api-client/testing";
import * as SearchAtoms from "@stash/web-search/search-atoms";
import * as Effect from "effect/Effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Fixtures from "./fixtures.ts";
import { mountAt, settle } from "./mount-page.ts";

enableAutoUnmount(afterEach);

const body = (wrapper: VueWrapper) => new DOMWrapper(wrapper.element.ownerDocument.body);

const devices = [
  { id: "device-1", name: "Laptop", kind: "zen", createdAt: "2026-01-01T00:00:00.000Z" },
];

const hits = (...links: ReadonlyArray<ReturnType<typeof Fixtures.link>>) =>
  ApiTesting.json({ hits: links.map((link, i) => ({ link, score: 1 - i / 10 })) });

/**
 * A stub api with a feed of two links and a `GET /search` that records each query and answers
 * with `answer(query)`.
 */
const api = (
  answer: (query: Record<string, string>) => Response | Effect.Effect<Response> = () =>
    hits(Fixtures.link("r1"), Fixtures.link("r2")),
) => {
  const searches: Array<Record<string, string>> = [];
  const routes: ApiTesting.Routes = {
    "GET /links": () => Fixtures.page([Fixtures.link("a"), Fixtures.link("b")]),
    "GET /devices": () => ApiTesting.json(devices),
    "GET /search": (request) => {
      const query = Fixtures.query(request);
      searches.push(query);
      return answer(query);
    },
  };
  return { searches, routes };
};

const titles = (wrapper: VueWrapper) =>
  wrapper.findAll("[data-slot=link-row] a[href^='/links/']").map((a) => a.text());
const summary = (wrapper: VueWrapper) => wrapper.find("[data-slot=search-summary]");
const marks = (wrapper: VueWrapper) =>
  wrapper.findAll("[data-slot=match-mark]").map((mark) => mark.text());

const pick = async (wrapper: VueWrapper, menu: string, option: string) => {
  const trigger = wrapper
    .findAll("[data-slot=filter-menu]")
    .find((item) => item.text().startsWith(menu));
  await trigger?.trigger("keydown", { key: "Enter" });
  await settle();
  const items = body(wrapper).findAll("[role=menuitemradio]");
  await items.find((item) => item.text() === option)?.trigger("click");
  await settle();
};

describe("inbox page, searching", () => {
  it("shows the feed and no search line without a query", async () => {
    const { searches, routes } = api();
    const { wrapper } = await mountAt("/links", routes);
    expect(titles(wrapper)).toEqual(["Example article a", "Example article b"]);
    expect(summary(wrapper).exists()).toBe(false);
    expect(wrapper.find("[role=radiogroup][aria-label=Feed]").exists()).toBe(true);
    expect(searches).toEqual([]);
  });

  it("turns the list into the results of ?q=, under a line that counts them", async () => {
    const { searches, routes } = api();
    const { wrapper } = await mountAt("/links?q=article", routes);
    expect(searches).toEqual([{ q: "article", mode: "hybrid" }]);
    expect(titles(wrapper)).toEqual(["Example article r1", "Example article r2"]);
    expect(summary(wrapper).text()).toBe("2 results for “article”");
    // The same page and rows: the heading stays, the feed switch gives way to the search line,
    // and results are ranked, not grouped by day.
    expect(wrapper.find("h1").text()).toBe("Inbox");
    expect(wrapper.find("[role=radiogroup][aria-label=Feed]").exists()).toBe(false);
    expect(wrapper.findAll("[data-slot=link-day]")).toHaveLength(0);
    expect(wrapper.find("[data-slot=search-results]").attributes("aria-label")).toBe("Results");
  });

  it("marks the query's terms in the title and the summary", async () => {
    const { routes } = api(() =>
      hits(Fixtures.link("r1", { title: "Rust in anger", summary: "Notes on rust and Go." })),
    );
    const { wrapper } = await mountAt("/links?q=rust", routes);
    expect(marks(wrapper)).toEqual(["Rust", "rust"]);
    expect(titles(wrapper)).toEqual(["Rust in anger"]);
  });

  it("marks nothing when searching by meaning", async () => {
    const { routes } = api(() => hits(Fixtures.link("r1", { title: "Rust in anger" })));
    const { wrapper } = await mountAt("/links?q=rust&mode=semantic", routes);
    expect(titles(wrapper)).toEqual(["Rust in anger"]);
    expect(marks(wrapper)).toEqual([]);
  });

  it("restores the feed when the query leaves the URL", async () => {
    const { routes } = api();
    const { wrapper, router } = await mountAt("/links?q=article", routes);
    await router.replace("/links");
    await settle();
    expect(titles(wrapper)).toEqual(["Example article a", "Example article b"]);
    expect(summary(wrapper).exists()).toBe(false);
    expect(wrapper.findAll("[data-slot=link-day]").length).toBeGreaterThan(0);
  });

  it("keeps the last results on screen while the next query loads", async () => {
    let release: (response: Response) => void = () => {};
    const { routes } = api((query) =>
      query["q"] === "art"
        ? hits(Fixtures.link("r1"))
        : Effect.promise(() => new Promise<Response>((resolve) => (release = resolve))),
    );
    const { wrapper, router } = await mountAt("/links?q=art", routes);
    expect(titles(wrapper)).toEqual(["Example article r1"]);

    await router.replace("/links?q=article");
    await settle();
    // Nothing blanks or jumps: the old rows stay, and the line says it is busy.
    expect(titles(wrapper)).toEqual(["Example article r1"]);
    expect(wrapper.find("[data-slot=skeleton]").exists()).toBe(false);
    expect(wrapper.find("[data-slot=search-bar]").attributes("aria-busy")).toBe("true");

    release(hits(Fixtures.link("r2"), Fixtures.link("r3")));
    await settle();
    expect(titles(wrapper)).toEqual(["Example article r2", "Example article r3"]);
    expect(summary(wrapper).text()).toBe("2 results for “article”");
    expect(wrapper.find("[data-slot=search-bar]").attributes("aria-busy")).toBeUndefined();
  });

  it("says so when nothing matches", async () => {
    const { routes } = api(() => hits());
    const { wrapper } = await mountAt("/links?q=zzz", routes);
    expect(summary(wrapper).text()).toBe("0 results for “zzz”");
    expect(wrapper.text()).toContain("No matches");
    expect(wrapper.find("[data-slot=start-saving]").exists()).toBe(false);
  });

  it("offers a retry when the search fails", async () => {
    let fail = true;
    const { searches, routes } = api(() =>
      fail ? new Response(null, { status: 500 }) : hits(Fixtures.link("r1")),
    );
    const { wrapper } = await mountAt("/links?q=article", routes);
    await vi.waitFor(() => expect(wrapper.text()).toContain("Search failed"));
    fail = false;
    await wrapper.find("[data-action=retry]").trigger("click");
    await settle();
    expect(titles(wrapper)).toEqual(["Example article r1"]);
    expect(searches.length).toBeGreaterThan(1);
  });

  it("puts the mode and the menus in the URL, and searches with them", async () => {
    const { searches, routes } = api();
    const { wrapper, router } = await mountAt("/links?q=article", routes);
    await pick(wrapper, "Hybrid", "Keywords");
    expect(router.currentRoute.value.query).toEqual({ q: "article", mode: "keyword" });
    await pick(wrapper, "Type", "Video");
    await pick(wrapper, "Device", "Laptop");
    await pick(wrapper, "Date", "Past week");
    expect(router.currentRoute.value.query).toEqual({
      q: "article",
      mode: "keyword",
      type: "video",
      device: "device-1",
      range: "week",
    });
    expect(searches.at(-1)).toEqual({
      q: "article",
      mode: "keyword",
      type: "video",
      deviceId: "device-1",
      since: expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:00:00\.000Z$/),
    });
  });

  it("narrows the results by a tag on a row, and clears it from the line", async () => {
    const { searches, routes } = api();
    const { wrapper, router } = await mountAt("/links?q=article", routes);
    await wrapper.find("[data-filter=tag]").trigger("click");
    await settle();
    expect(router.currentRoute.value.query).toEqual({ q: "article", tag: "economics" });
    expect(searches.at(-1)).toEqual({ q: "article", mode: "hybrid", tag: "economics" });

    await wrapper.find("[data-clear=tag]").trigger("click");
    await settle();
    expect(router.currentRoute.value.query).toEqual({ q: "article" });
  });

  it("keeps the Inbox's type filter when the search is cleared", async () => {
    const { routes } = api();
    const { wrapper, router } = await mountAt("/links?q=article&type=video", routes);
    expect(wrapper.find("[data-slot=search-bar]").text()).toContain("Type: Video");
    await router.replace("/links?type=video");
    await settle();
    expect(wrapper.find("[role=group][aria-label=Filters]").text()).toContain("Type: Video");
  });

  it("moves through the results with the Inbox's keys, and remembers an opened search", async () => {
    const { routes } = api();
    const { wrapper, router, registry, press } = await mountAt("/links?q=article", routes);
    registry.mount(SearchAtoms.recent);
    await press("ArrowDown");
    await press("ArrowDown");
    const selected = wrapper.find("[data-slot=link-row][data-state=selected]");
    expect(selected.text()).toContain("Example article r2");
    await press("Enter");
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe("/links/r2"));
    await settle();
    const recent = registry.get(SearchAtoms.recent);
    expect(recent._tag === "Success" && recent.value.map((entry) => entry.query)).toEqual([
      "article",
    ]);
  });
});
