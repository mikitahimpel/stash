import { DOMWrapper, enableAutoUnmount, type VueWrapper } from "@vue/test-utils";
import * as ApiTesting from "@stash/web-api-client/testing";
import * as Effect from "effect/Effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as LinksAtoms from "../src/links-atoms.ts";
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

  const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

  it("charts the links saved in the last 30 days once there are enough days to plot", async () => {
    const api = listing({
      first: Fixtures.page([
        Fixtures.link("a", { createdAt: daysAgo(0) }),
        Fixtures.link("b", { createdAt: daysAgo(1), status: "seen" }),
        Fixtures.link("c", { createdAt: daysAgo(2), status: "seen" }),
        Fixtures.link("d", { createdAt: "2020-01-01T00:00:00.000Z" }),
      ]),
    });
    const { wrapper } = await mountAt("/links", api.routes);

    expect(wrapper.find("[data-slot=page-header-subtitle]").text()).toBe(
      "1 unread · 3 saved in 30 days",
    );
    expect(wrapper.find("svg[role=img]").attributes("aria-label")).toContain("3 saved");
    expect(wrapper.find("[data-slot=saved-read-today-unread]").exists()).toBe(true);
    // The legend sits right under the chart.
    const chart = wrapper.find("[data-slot=saved-read-chart]").element;
    expect(chart.firstElementChild?.tagName.toLowerCase()).toBe("svg");
    expect(chart.lastElementChild?.tagName.toLowerCase()).toBe("figcaption");
  });

  it("keeps the chart off the page below three days with links", async () => {
    const api = listing({
      first: Fixtures.page([
        Fixtures.link("a", { createdAt: daysAgo(0) }),
        Fixtures.link("b", { createdAt: daysAgo(0) }),
        Fixtures.link("c", { createdAt: daysAgo(1) }),
      ]),
    });
    const { wrapper } = await mountAt("/links", api.routes);

    expect(wrapper.find("[data-slot=saved-read-chart]").exists()).toBe(false);
    expect(wrapper.find("[data-slot=page-header-subtitle]").text()).toBe(
      "3 unread · 3 saved in 30 days",
    );
  });

  it("shows the onboarding card and no chart when nothing is saved", async () => {
    const api = listing({ first: Fixtures.page([]) });
    const { wrapper } = await mountAt("/links", api.routes);

    const card = wrapper.find("[data-slot=start-saving]");
    expect(card.find("h2").text()).toBe("Start saving");
    const rows = card.findAll("li");
    expect(rows.map((row) => row.find("span").text())).toEqual([
      "Zen extension",
      "iPhone",
      "Claude",
    ]);
    // Each way to start has one action.
    expect(rows.map((row) => row.findAll("a").length)).toEqual([1, 1, 1]);
    expect(rows[0]?.find("a").attributes("href")).toBe("/settings?add=device&kind=zen");
    expect(rows[1]?.find("a").attributes("href")).toContain("ios-shortcut.md");
    expect(rows[2]?.find("a").attributes("href")).toContain("mcp-connector.md");

    expect(wrapper.find("[data-slot=saved-read-chart]").exists()).toBe(false);
    expect(wrapper.find("svg[role=img]").exists()).toBe(false);
    expect(wrapper.find("[role=radiogroup]").exists()).toBe(false);
    expect(wrapper.find("[data-slot=page-header-subtitle]").exists()).toBe(false);
    expect(wrapper.find("[data-slot=empty-state]").exists()).toBe(false);
  });

  it("doesn't take a returning user for a new one when a feed is empty", async () => {
    const old = Fixtures.link("a", { createdAt: "2026-01-01T00:00:00.000Z", status: "seen" });
    // Nothing is unseen, and nothing is from the last 30 days.
    const routes: ApiTesting.Routes = {
      "GET /devices": () => ApiTesting.json(devices),
      "GET /links": (request) => Fixtures.page(Fixtures.query(request).seen ? [] : [old]),
    };
    const { wrapper } = await mountAt("/links", routes);
    expect(titles(wrapper)).toEqual(["Example article a"]);

    await radio(wrapper, "Not yet seen")?.trigger("click");
    await settle();

    expect(wrapper.find("[data-slot=start-saving]").exists()).toBe(false);
    expect(wrapper.find("[data-slot=empty-state]").text()).toContain("All caught up");
    // The feed switch stays, so there is a way back.
    expect(wrapper.findAll("[role=radio]")).toHaveLength(3);
  });

  it("doesn't take archiving everything for a first run", async () => {
    const archived = Fixtures.link("a", {
      createdAt: "2026-01-01T00:00:00.000Z",
      status: "archived",
    });
    const { wrapper } = await mountAt(
      "/links",
      listing({ first: Fixtures.page([archived]) }).routes,
    );

    expect(wrapper.find("[data-slot=start-saving]").exists()).toBe(false);
    expect(wrapper.findAll("[role=radio]")).toHaveLength(3);
  });

  it("has one primary action, and no row of raised filters", async () => {
    const api = listing({ first: Fixtures.page([Fixtures.link("a")]) });
    const { wrapper } = await mountAt("/links", api.routes);

    expect(wrapper.findAll(".tactile-primary").map((el) => el.text())).toEqual(["Save"]);
    expect(wrapper.find("[aria-label=Filters] .tactile-raised").exists()).toBe(false);
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

  it("sets and clears the type filter from its menu", async () => {
    const api = listing({ first: Fixtures.page([Fixtures.link("a")]) });
    const { wrapper, router } = await mountAt("/links", api.routes);

    const menu = () => wrapper.find("[data-slot=filter-menu]");
    const pick = async (label: string) => {
      await menu().trigger("keydown", { key: "Enter" });
      await settle();
      const items = body(wrapper).findAll("[role=menuitemradio]");
      await items.find((item) => item.text() === label)?.trigger("click");
      await settle();
    };
    expect(menu().text()).toBe("Type: Any");

    await pick("Video");
    expect(router.currentRoute.value.query).toEqual({ type: "video" });
    expect(api.queries.at(-1)).toEqual({ sort: "recent", type: "video" });
    expect(menu().text()).toBe("Type: Video");

    await pick("Any");
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

describe("save a link", () => {
  /** The feed answers with what the api has; `POST /links` adds to it. */
  const saving = (respond?: Effect.Effect<void>) => {
    const saved: Array<ReturnType<typeof Fixtures.link>> = [];
    const posts: Array<unknown> = [];
    const routes: ApiTesting.Routes = {
      "GET /devices": () => ApiTesting.json(devices),
      "GET /links": () => Fixtures.page(saved),
      "POST /links": (request) =>
        Effect.gen(function* () {
          const payload = (yield* Fixtures.body(request)) as { url: string };
          posts.push(payload);
          if (respond !== undefined) yield* respond;
          const link = Fixtures.link("new", {
            url: payload.url,
            title: "A new link",
            createdAt: new Date().toISOString(),
          });
          saved.push(link);
          return ApiTesting.json(link, 201);
        }),
    };
    return { posts, routes };
  };

  const field = (wrapper: VueWrapper) =>
    wrapper.find<HTMLInputElement>("input[aria-label='Save a link']");
  const submit = async (wrapper: VueWrapper, text: string) => {
    await field(wrapper).setValue(text);
    await wrapper.find("[data-slot=save-link]").trigger("submit");
  };

  it("sends POST /links and shows the row", async () => {
    const api = saving();
    const { wrapper } = await mountAt("/links", api.routes);
    expect(wrapper.find("[data-slot=start-saving]").exists()).toBe(true);

    await submit(wrapper, "https://example.com/new");
    await settle();

    expect(api.posts).toEqual([{ url: "https://example.com/new" }]);
    expect(titles(wrapper)).toEqual(["A new link"]);
    expect(wrapper.find("[data-slot=pending-link]").exists()).toBe(false);
    expect(wrapper.find("[data-slot=start-saving]").exists()).toBe(false);
    expect(field(wrapper).element.value).toBe("");
  });

  it("shows the row at once, before the api answers", async () => {
    let answer: () => void = () => {};
    const answered = new Promise<void>((resolve) => (answer = resolve));
    const api = saving(Effect.promise(() => answered));
    const { wrapper } = await mountAt("/links", api.routes);

    await submit(wrapper, "https://example.com/new");
    await settle();
    expect(wrapper.find("[data-slot=pending-link]").text()).toContain("https://example.com/new");
    expect(wrapper.find("[data-slot=start-saving]").exists()).toBe(false);

    answer();
    await settle();
    await vi.waitFor(() => expect(titles(wrapper)).toEqual(["A new link"]));
    expect(wrapper.find("[data-slot=pending-link]").exists()).toBe(false);
  });

  it("assumes https for a bare host", async () => {
    const api = saving();
    const { wrapper } = await mountAt("/links", api.routes);

    await submit(wrapper, "  example.com/new ");
    await settle();
    expect(api.posts).toEqual([{ url: "https://example.com/new" }]);
  });

  it.each(["localhost:3000/a", "example.com:8080/a"])(
    "reads %s as a host and port",
    async (text) => {
      const api = saving();
      const { wrapper } = await mountAt("/links", api.routes);

      await submit(wrapper, text);
      await settle();
      expect(api.posts).toEqual([{ url: `https://${text}` }]);
    },
  );

  it.each(["not a link", "mailto:someone@example.com"])("refuses %s", async (text) => {
    const api = saving();
    const { wrapper } = await mountAt("/links", api.routes);

    await submit(wrapper, text);
    await settle();
    expect(api.posts).toEqual([]);
  });

  it("refuses what isn't a link without calling the api", async () => {
    const api = saving();
    const { wrapper } = await mountAt("/links", api.routes);

    await submit(wrapper, "not a link");
    await settle();
    expect(api.posts).toEqual([]);
    expect(wrapper.find("[data-slot=save-link] [role=alert]").exists()).toBe(true);
    expect(field(wrapper).element.value).toBe("not a link");
  });

  it("takes the row back and keeps the link in the field when saving fails", async () => {
    const { wrapper } = await mountAt("/links", {
      ...saving().routes,
      "POST /links": () => new Response("oops", { status: 500 }),
    });

    await submit(wrapper, "https://example.com/new");
    await settle();
    await vi.waitFor(() =>
      expect(wrapper.find("[data-slot=save-link] [role=alert]").text()).toContain("Couldn't save"),
    );
    expect(wrapper.find("[data-slot=pending-link]").exists()).toBe(false);
    expect(field(wrapper).element.value).toBe("https://example.com/new");
  });

  it("drops a saved link the filtered feed won't show", async () => {
    const api = saving();
    const { wrapper, registry } = await mountAt("/links?type=video", api.routes);

    await submit(wrapper, "https://example.com/new");
    await settle();
    expect(wrapper.find("[data-slot=pending-link]").exists()).toBe(false);
    await vi.waitFor(() => expect(registry.get(LinksAtoms.pending)).toEqual([]));
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
