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

const mountPage = (routes: ApiTesting.Routes) => {
  registry = ApiTesting.makeRegistry(routes);
  return mount(SearchPage, { global: { provide: { [AtomVue.registryKey]: registry } } });
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

  it("shows a loading state while the search runs", async () => {
    const wrapper = mountPage({ "GET /search": () => Effect.never });
    await type(wrapper, "rust");
    expect(wrapper.find("[data-testid=search-loading]").exists()).toBe(true);
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
    expect(items[0]?.find("a").attributes("href")).toBe("https://example.com/articles/a");
    expect(items[0]?.text()).toContain("A summary");
    expect(items[0]?.text()).toContain("#rust");
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
    await wrapper.find("select[aria-label=Type]").setValue("video");
    await flushPromises();
    expect(types).toEqual([null, "video"]);
  });
});
