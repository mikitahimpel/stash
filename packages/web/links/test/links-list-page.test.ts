import { DOMWrapper, enableAutoUnmount, type VueWrapper } from "@vue/test-utils";
import * as ApiTesting from "@stash/web-api-client/testing";
import * as Effect from "effect/Effect";
import { afterEach, describe, expect, it } from "vitest";
import * as Fixtures from "./fixtures.ts";
import { mountAt, settle } from "./mount-page.ts";

enableAutoUnmount(afterEach);

// Dialogs teleport to <body>, outside the wrapper.
const body = (wrapper: VueWrapper) => new DOMWrapper(wrapper.element.ownerDocument.body);

/** A stub `GET /links` that records each query and answers with `pages[cursor ?? "first"]`. */
const listing = (pages: Record<string, ReturnType<typeof Fixtures.page>>) => {
  const queries: Array<Record<string, string>> = [];
  const routes: ApiTesting.Routes = {
    "GET /links": (request) => {
      const query = Fixtures.query(request);
      queries.push(query);
      return (pages[query.cursor ?? "first"] ?? Fixtures.page([])).clone();
    },
  };
  return { queries, routes };
};

const titles = (wrapper: VueWrapper) =>
  wrapper.findAll("[data-slot=link-card] a[href^='/links/']").map((a) => a.text());

describe("links list page", () => {
  it("shows the cards of the feed", async () => {
    const api = listing({ first: Fixtures.page([Fixtures.link("a"), Fixtures.link("b")]) });
    const { wrapper } = await mountAt("/links", api.routes);

    expect(titles(wrapper)).toEqual(["Example article a", "Example article b"]);
    const card = wrapper.find("[data-slot=link-card]");
    expect(card.text()).toContain("example.com");
    expect(card.text()).toContain("A summary of article a.");
    expect(card.text()).toContain("#economics");
    expect(card.text()).toContain("Article");
    expect(api.queries).toEqual([{ sort: "recent" }]);
  });

  it("loads the filters from the URL query", async () => {
    const api = listing({ first: Fixtures.page([Fixtures.link("a")]) });
    await mountAt("/links?feed=unseen&tag=economics&type=video", api.routes);

    expect(api.queries).toEqual([
      { sort: "recent", seen: "false", tag: "economics", type: "video" },
    ]);
  });

  it("writes the feed to the URL query when a feed tab is chosen", async () => {
    const api = listing({ first: Fixtures.page([Fixtures.link("a")]) });
    const { wrapper, router } = await mountAt("/links", api.routes);

    const unseen = wrapper.findAll("[role=tab]").find((tab) => tab.text() === "Not yet seen");
    await unseen?.trigger("mousedown", { button: 0 });
    await settle();

    expect(router.currentRoute.value.query).toEqual({ feed: "unseen" });
    expect(api.queries.at(-1)).toEqual({ sort: "recent", seen: "false" });
  });

  it("writes the type to the URL query when a type is selected, and clears it with All", async () => {
    const api = listing({ first: Fixtures.page([Fixtures.link("a")]) });
    const { wrapper, router } = await mountAt("/links", api.routes);

    await wrapper.find("select[name=type]").setValue("video");
    await settle();
    expect(router.currentRoute.value.query).toEqual({ type: "video" });
    expect(api.queries.at(-1)).toEqual({ sort: "recent", type: "video" });

    await wrapper.find("select[name=type]").setValue("");
    await settle();
    expect(router.currentRoute.value.query).toEqual({});
  });

  it("filters by a tag clicked on a card, and clears it from the chip", async () => {
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

  it("filters by the type badge of a card", async () => {
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
  const withMutations = () => {
    const patches: Array<{ id: string; payload: unknown }> = [];
    const removed: Array<string> = [];
    const api = listing({ first: Fixtures.page([Fixtures.link("a")]) });
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

  it.each([
    ["seen", "seen"],
    ["done", "done"],
    ["archived", "archived"],
  ])("sends PATCH /links/:id with status %s and reloads the feed", async (action, status) => {
    const api = withMutations();
    const { wrapper } = await mountAt("/links", api.routes);

    await wrapper.find(`[data-action=${action}]`).trigger("click");
    await settle();

    expect(api.patches).toEqual([{ id: "a", payload: { status } }]);
    expect(api.queries).toHaveLength(2);
  });

  it("offers only the status changes that apply", async () => {
    const api = listing({ first: Fixtures.page([Fixtures.link("a", { status: "done" })]) });
    const { wrapper } = await mountAt("/links", api.routes);

    const actions = wrapper
      .findAll("[data-slot=link-card] [data-action]")
      .map((el) => el.attributes("data-action"));
    expect(actions).toEqual(["archived", "delete"]);
  });

  it("deletes only after confirming", async () => {
    const api = withMutations();
    const { wrapper } = await mountAt("/links", api.routes);

    await wrapper.find("[data-action=delete]").trigger("click");
    await settle();
    expect(api.removed).toEqual([]);

    await body(wrapper).find("[data-action=confirm-delete]").trigger("click");
    await settle();
    expect(api.removed).toEqual(["a"]);
    expect(api.queries).toHaveLength(2);
  });

  it("shows an error when the mutation fails", async () => {
    const api = withMutations();
    const { wrapper } = await mountAt("/links", {
      ...api.routes,
      "PATCH /links/:id": (_, { id = "" }) =>
        ApiTesting.json({ _tag: "NotFound", resource: "link", id }, 404),
    });

    await wrapper.find("[data-action=seen]").trigger("click");
    await settle();
    expect(wrapper.find("[role=alert]").text()).toContain("didn't work");
  });
});
