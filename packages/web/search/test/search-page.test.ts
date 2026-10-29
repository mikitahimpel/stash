import * as AtomVue from "@effect/atom-vue";
import * as ApiTesting from "@stash/web-api-client/testing";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import * as Effect from "effect/Effect";
import * as UrlParams from "effect/http/UrlParams";
import * as Option from "effect/Option";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as SearchAtoms from "../src/search-atoms.ts";
import SearchPage from "../src/search-page.vue";
import * as Fixtures from "./fixtures.ts";

enableAutoUnmount(afterEach);

let registry: AtomRegistry.AtomRegistry | undefined;

// The timeline's background: one page of recent links.
const savedLinks = {
  "GET /links": () =>
    ApiTesting.json({
      items: [
        Fixtures.link("s1", { tags: ["rust", "go"] }),
        Fixtures.link("s2", { tags: ["rust"] }),
      ],
      nextCursor: null,
    }),
};

const mountPage = (routes: ApiTesting.Routes) => {
  registry = ApiTesting.makeRegistry({ ...savedLinks, ...routes });
  return mount(SearchPage, {
    attachTo: "body",
    global: { provide: { [AtomVue.registryKey]: registry } },
  });
};

const type = async (wrapper: ReturnType<typeof mountPage>, text: string) => {
  await wrapper.find("input[type=search]").setValue(text);
  await vi.advanceTimersByTimeAsync(SearchAtoms.debounceMillis);
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
  it("invites a query before anything is typed", () => {
    const wrapper = mountPage({});
    expect(wrapper.text()).toContain("Find a link");
    expect(wrapper.find("ul").exists()).toBe(false);
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

  it("lists the hits", async () => {
    const wrapper = mountPage({
      "GET /search": () =>
        ApiTesting.json({
          hits: [
            {
              link: Fixtures.link("a", { type: "repo", tags: ["rust"], summary: "A summary" }),
              score: 0.9,
            },
            { link: Fixtures.link("b"), score: 0.5 },
          ],
        }),
    });
    await type(wrapper, "rust");

    const items = wrapper.findAll("ul[aria-label=Results] li");
    expect(items.map((item) => item.find("a").text())).toEqual([
      "Example article a",
      "Example article b",
    ]);
    expect(items.map((item) => item.find("span").text())).toEqual(["1", "2"]);
    expect(items[0]?.find("a").attributes("href")).toBe("https://example.com/articles/a");
    expect(items[0]?.text()).toContain("A summary");
    expect(items[0]?.text()).toContain("repo · 2026-01-01");
    expect(wrapper.text()).toContain("2 results");
  });

  it("highlights the query's terms in keyword and hybrid mode, not in meaning mode", async () => {
    const wrapper = mountPage({
      "GET /search": () =>
        ApiTesting.json({
          hits: [
            { link: Fixtures.link("a", { summary: "Быстрый Rust и rust-analyzer" }), score: 1 },
          ],
        }),
    });
    await type(wrapper, "RUST");
    expect(wrapper.findAll("mark").map((mark) => mark.text())).toEqual(["Rust", "rust"]);

    await wrapper.find("[role=radio]:nth-child(2)").trigger("click");
    await flushPromises();
    expect(wrapper.find("[role=radio][aria-checked=true]").text()).toBe("Meaning");
    expect(wrapper.findAll("mark")).toEqual([]);
  });

  it("numbers the matches on the timeline by rank", async () => {
    const wrapper = mountPage({
      "GET /search": () =>
        ApiTesting.json({
          hits: [
            { link: Fixtures.link("a", { createdAt: new Date().toISOString() }), score: 0.9 },
            { link: Fixtures.link("b", { createdAt: new Date().toISOString() }), score: 0.5 },
          ],
        }),
    });
    await type(wrapper, "rust");
    const timeline = wrapper.find("svg[role=img]");
    expect(
      timeline
        .findAll("[data-testid=timeline-match]")
        .map((match) => match.attributes("data-rank")),
    ).toEqual(["1", "2"]);
    expect(timeline.attributes("aria-label")).toMatch(/^2 matches/);
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

  it("says so when nothing matches", async () => {
    const wrapper = mountPage({ "GET /search": () => ApiTesting.json({ hits: [] }) });
    await type(wrapper, "nothing like this");
    expect(wrapper.text()).toContain("No matches");
  });

  it("searches again with the type filter", async () => {
    const types: Array<string | null> = [];
    const wrapper = mountPage({
      "GET /search": (request) => {
        types.push(Option.getOrNull(UrlParams.getFirst(request.urlParams, "type")));
        return ApiTesting.json(Fixtures.results("a"));
      },
    });
    await type(wrapper, "rust");
    const video = wrapper
      .findAll("[role=group][aria-label=Type] button")
      .find((chip) => chip.text() === "Video");
    await video?.trigger("click");
    await flushPromises();
    expect(types).toEqual([null, "video"]);
    expect(video?.attributes("aria-pressed")).toBe("true");
  });

  it("offers the frequent tags as chips and filters by one", async () => {
    const tags: Array<string | null> = [];
    const wrapper = mountPage({
      "GET /search": (request) => {
        tags.push(Option.getOrNull(UrlParams.getFirst(request.urlParams, "tag")));
        return ApiTesting.json(Fixtures.results("a"));
      },
    });
    await type(wrapper, "rust");
    const chips = wrapper.findAll("[role=group][aria-label=Tag] button");
    expect(chips.map((chip) => chip.text())).toEqual(["#rust", "#go"]);
    await chips[1]?.trigger("click");
    await flushPromises();
    expect(tags).toEqual([null, "go"]);
  });
});
