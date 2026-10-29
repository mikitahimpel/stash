import { DOMWrapper, enableAutoUnmount, type VueWrapper } from "@vue/test-utils";
import * as ApiTesting from "@stash/web-api-client/testing";
import * as Effect from "effect/Effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Fixtures from "./fixtures.ts";
import { mountAt, settle } from "./mount-page.ts";

enableAutoUnmount(afterEach);

// Dialogs teleport to <body>, outside the wrapper.
const body = (wrapper: VueWrapper) => new DOMWrapper(wrapper.element.ownerDocument.body);

const devices = [
  { id: "device-1", name: "Laptop", kind: "zen", createdAt: "2026-01-01T00:00:00.000Z" },
];

/**
 * A stub `GET /links` that records each feed query and answers with `pages[cursor ?? "first"]`.
 * The chart's requests (with `limit`) get the first page too, but aren't recorded.
 */
const listing = (pages: Record<string, ReturnType<typeof Fixtures.page>>) => {
  const queries: Array<Record<string, string>> = [];
  const routes: ApiTesting.Routes = {
    "GET /links": (request) => {
      const query = Fixtures.query(request);
      if (query.limit === undefined) queries.push(query);
      return (pages[query.cursor ?? "first"] ?? Fixtures.page([])).clone();
    },
    "GET /devices": () => ApiTesting.json(devices),
  };
  return { queries, routes };
};

const titles = (wrapper: VueWrapper) =>
  wrapper.findAll("[data-slot=link-row] a[href^='/links/']").map((a) => a.text());

const radio = (wrapper: VueWrapper, label: string) =>
  wrapper.findAll("[role=radio]").find((segment) => segment.text() === label);

describe("inbox page", () => {
  it("shows the rows of the feed, grouped by day", async () => {
    const api = listing({
      first: Fixtures.page([
        Fixtures.link("a", { sourceDeviceId: "device-1" }),
        Fixtures.link("b"),
        Fixtures.link("c", { createdAt: "2025-12-30T12:00:00.000Z" }),
      ]),
    });
    const { wrapper } = await mountAt("/links", api.routes);

    expect(titles(wrapper)).toEqual([
      "Example article a",
      "Example article b",
      "Example article c",
    ]);
    const days = wrapper.findAll("[data-slot=link-day]");
    expect(days).toHaveLength(2);
    expect(days[0]?.find("[data-slot=section-header-count]").text()).toBe("2");
    const row = wrapper.find("[data-slot=link-row]");
    expect(row.text()).toContain("example.com");
    expect(row.text()).toContain("A summary of article a.");
    expect(row.text()).toContain("#economics");
    expect(row.find("[data-slot=link-device]").text()).toBe("Laptop");
    expect(api.queries).toEqual([{ sort: "recent" }]);
  });

  it("says summarizing… until enrichment ran", async () => {
    const api = listing({ first: Fixtures.page([Fixtures.link("a", { enrichedAt: null })]) });
    const { wrapper } = await mountAt("/links", api.routes);

    expect(wrapper.find("[data-slot=link-row]").text()).toContain("summarizing…");
    expect(wrapper.find("[data-slot=link-row]").text()).not.toContain("A summary of article a.");
  });

  it("charts the links saved in the last 30 days", async () => {
    const now = new Date().toISOString();
    const api = listing({
      first: Fixtures.page([
        Fixtures.link("a", { createdAt: now }),
        Fixtures.link("b", { createdAt: now, status: "seen" }),
        Fixtures.link("c", { createdAt: "2020-01-01T00:00:00.000Z" }),
      ]),
    });
    const { wrapper } = await mountAt("/links", api.routes);

    expect(wrapper.find("[data-slot=page-header-subtitle]").text()).toBe(
      "2 saved · 1 read · 1 unread · last 30 days",
    );
    expect(wrapper.find("svg[role=img]").attributes("aria-label")).toContain("2 saved");
    expect(wrapper.find("[data-slot=saved-read-today-unread]").exists()).toBe(true);
  });

  it("loads the filters from the URL query", async () => {
    const api = listing({ first: Fixtures.page([Fixtures.link("a")]) });
    await mountAt("/links?feed=unseen&tag=economics&type=video", api.routes);

    expect(api.queries).toEqual([
      { sort: "recent", seen: "false", tag: "economics", type: "video" },
    ]);
  });

  it("writes the feed to the URL query when a feed segment is chosen", async () => {
    const api = listing({ first: Fixtures.page([Fixtures.link("a")]) });
    const { wrapper, router } = await mountAt("/links", api.routes);

    await radio(wrapper, "Not yet seen")?.trigger("click");
    await settle();
    expect(router.currentRoute.value.query).toEqual({ feed: "unseen" });
    expect(api.queries.at(-1)).toEqual({ sort: "recent", seen: "false" });

    await radio(wrapper, "All")?.trigger("click");
    await settle();
    expect(router.currentRoute.value.query).toEqual({ feed: "all" });
  });

  it("hides archived links on Recent and shows them on All", async () => {
    const api = listing({
      first: Fixtures.page([Fixtures.link("a"), Fixtures.link("b", { status: "archived" })]),
    });
    const recent = await mountAt("/links", api.routes);
    expect(titles(recent.wrapper)).toEqual(["Example article a"]);

    const all = await mountAt("/links?feed=all", api.routes);
    expect(titles(all.wrapper)).toEqual(["Example article a", "Example article b"]);
  });

  it("toggles the type filter with its chip", async () => {
    const api = listing({ first: Fixtures.page([Fixtures.link("a")]) });
    const { wrapper, router } = await mountAt("/links", api.routes);

    const chip = () => wrapper.find("[data-slot=toggle-chip][data-filter-type=video]");
    await chip().trigger("click");
    await settle();
    expect(router.currentRoute.value.query).toEqual({ type: "video" });
    expect(api.queries.at(-1)).toEqual({ sort: "recent", type: "video" });
    expect(chip().attributes("aria-pressed")).toBe("true");

    await chip().trigger("click");
    await settle();
    expect(router.currentRoute.value.query).toEqual({});
  });

  it("filters by a tag clicked on a row, and clears it from the chip", async () => {
    const api = listing({ first: Fixtures.page([Fixtures.link("a")]) });
    const { wrapper, router } = await mountAt("/links?feed=unseen", api.routes);

    await wrapper.find("[data-filter=tag]").trigger("click");
    await settle();
    expect(router.currentRoute.value.query).toEqual({ feed: "unseen", tag: "economics" });
    expect(api.queries.at(-1)).toEqual({ sort: "recent", seen: "false", tag: "economics" });

    await wrapper.find("[data-clear=tag]").trigger("click");
    await settle();
    expect(router.currentRoute.value.query).toEqual({ feed: "unseen" });
  });

  it("filters by the type of a row", async () => {
    const api = listing({ first: Fixtures.page([Fixtures.link("a", { type: "repo" })]) });
    const { wrapper, router } = await mountAt("/links", api.routes);

    await wrapper.find("[data-filter=type]").trigger("click");
    await settle();
    expect(router.currentRoute.value.query).toEqual({ type: "repo" });
  });

  it("loads the next page with the cursor until the last one", async () => {
    const api = listing({
      first: Fixtures.page([Fixtures.link("a")], "page-2"),
      "page-2": Fixtures.page([Fixtures.link("b")]),
    });
    const { wrapper } = await mountAt("/links", api.routes);

    await wrapper.find("[data-action=load-more]").trigger("click");
    await settle();
    expect(titles(wrapper)).toEqual(["Example article a", "Example article b"]);
    expect(api.queries.at(-1)).toEqual({ sort: "recent", cursor: "page-2" });

    // The last page had no cursor: one more pull ends the feed without a request.
    await wrapper.find("[data-action=load-more]").trigger("click");
    await settle();
    expect(wrapper.find("[data-action=load-more]").exists()).toBe(false);
    expect(api.queries).toHaveLength(2);
  });

  it("shows an empty state when nothing matches", async () => {
    const api = listing({ first: Fixtures.page([]) });
    const { wrapper } = await mountAt("/links?type=video", api.routes);

    expect(wrapper.find("[data-slot=empty-state]").text()).toContain(
      "No links match these filters.",
    );
  });
});

describe("link actions", () => {
  const withMutations = (links = [Fixtures.link("a"), Fixtures.link("b")]) => {
    const patches: Array<{ id: string; payload: unknown }> = [];
    const removed: Array<string> = [];
    const api = listing({ first: Fixtures.page(links) });
    const routes: ApiTesting.Routes = {
      ...api.routes,
      "PATCH /links/:id": (request, { id = "" }) =>
        Effect.map(Fixtures.body(request), (payload) => {
          patches.push({ id, payload });
          return ApiTesting.json(Fixtures.link(id, payload as Record<string, unknown>));
        }),
      "DELETE /links/:id": (_, { id = "" }) => {
        removed.push(id);
        return new Response(null, { status: 204 });
      },
    };
    return { patches, removed, queries: api.queries, routes };
  };

  const selected = (wrapper: VueWrapper) =>
    wrapper.findAll("[data-slot=link-row]").findIndex((row) => row.attributes("data-state"));

  it("selects a row with ↑/↓ and reveals its action bar", async () => {
    const api = withMutations();
    const { wrapper, press } = await mountAt("/links", api.routes);
    expect(wrapper.find("[data-slot=list-row-actions]").exists()).toBe(false);

    expect(await press("ArrowDown")).toBe(true);
    expect(selected(wrapper)).toBe(0);
    await press("ArrowDown");
    expect(selected(wrapper)).toBe(1);
    await press("ArrowDown");
    expect(selected(wrapper)).toBe(1);
    await press("ArrowUp");
    expect(selected(wrapper)).toBe(0);
    expect(wrapper.findAll("[data-slot=list-row-actions]")).toHaveLength(1);
  });

  it.each([
    ["s", "seen"],
    ["d", "done"],
    ["e", "archived"],
  ])("%s on the selected row sends PATCH /links/:id with status %s", async (key, status) => {
    const api = withMutations();
    const { press } = await mountAt("/links", api.routes);

    await press("ArrowDown");
    await press("ArrowDown");
    expect(await press(key)).toBe(true);

    expect(api.patches).toEqual([{ id: "b", payload: { status } }]);
    expect(api.queries).toHaveLength(2);
  });

  it("does nothing on S without a selected row", async () => {
    const api = withMutations();
    const { press } = await mountAt("/links", api.routes);

    await press("s");
    expect(api.patches).toEqual([]);
  });

  it("opens the selected row with ↵", async () => {
    const api = withMutations();
    const { press, router } = await mountAt("/links", api.routes);

    await press("ArrowDown");
    await press("Enter");
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe("/links/a"));
  });

  it.each([
    ["seen", "seen"],
    ["done", "done"],
    ["archived", "archived"],
  ])("the %s button of a clicked row sends PATCH and reloads the feed", async (action, status) => {
    const api = withMutations([Fixtures.link("a")]);
    const { wrapper } = await mountAt("/links", api.routes);

    await wrapper.find("[data-slot=link-row]").trigger("click");
    await wrapper.find(`[data-action=${action}]`).trigger("click");
    await settle();

    expect(api.patches).toEqual([{ id: "a", payload: { status } }]);
    expect(api.queries).toHaveLength(2);
  });

  it("offers only the status changes that apply", async () => {
    const api = withMutations([Fixtures.link("a", { status: "done" })]);
    const { wrapper } = await mountAt("/links", api.routes);

    await wrapper.find("[data-slot=link-row]").trigger("click");
    const actions = wrapper
      .findAll("[data-slot=list-row-actions] [data-action]")
      .map((el) => el.attributes("data-action"));
    expect(actions).toEqual(["archived", "delete"]);
  });

  it("deletes only after confirming", async () => {
    const api = withMutations([Fixtures.link("a")]);
    const { wrapper } = await mountAt("/links", api.routes);

    await wrapper.find("[data-slot=link-row]").trigger("click");
    await wrapper.find("[data-action=delete]").trigger("click");
    await settle();
    expect(api.removed).toEqual([]);

    await body(wrapper).find("[data-action=confirm-delete]").trigger("click");
    await settle();
    expect(api.removed).toEqual(["a"]);
    expect(api.queries).toHaveLength(2);
  });

  it("shows an error when the mutation fails", async () => {
    const api = withMutations([Fixtures.link("a")]);
    const { wrapper } = await mountAt("/links", {
      ...api.routes,
      "PATCH /links/:id": (_, { id = "" }) =>
        ApiTesting.json({ _tag: "NotFound", resource: "link", id }, 404),
    });

    await wrapper.find("[data-slot=link-row]").trigger("click");
    await wrapper.find("[data-action=seen]").trigger("click");
    await settle();
    expect(wrapper.find("[role=alert]").text()).toContain("didn't work");
  });
});
