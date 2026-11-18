import * as ApiTesting from "@stash/web-api-client/testing";
import * as PlatformTesting from "@stash/web-platform/testing";
import * as UrlParams from "effect/http/UrlParams";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as SearchAtoms from "../src/search-atoms.ts";
import * as Fixtures from "./fixtures.ts";

let registry: AtomRegistry.AtomRegistry | undefined;
let requests: Array<Record<string, unknown>> = [];

// A registry whose `GET /search` records the query parameters of every request.
const start = () => {
  requests = [];
  registry = ApiTesting.makeRegistry({
    "GET /search": (request) => {
      requests.push(UrlParams.toRecord(request.urlParams));
      return ApiTesting.json(Fixtures.results("a"));
    },
  });
  return registry;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});
afterEach(() => {
  registry?.dispose();
  registry = undefined;
  vi.useRealTimers();
});

describe("search atoms", () => {
  it("sends nothing when there is nothing to search for", async () => {
    const reg = start();
    reg.mount(SearchAtoms.results(undefined));
    await vi.advanceTimersByTimeAsync(0);
    expect(reg.get(SearchAtoms.results(undefined))).toBeNull();
    expect(requests).toEqual([]);
  });

  it("sends the query, the mode and the filters as query parameters", async () => {
    const reg = start();
    reg.mount(SearchAtoms.results({ q: "schema", mode: "keyword", type: "repo" }));
    await vi.advanceTimersByTimeAsync(0);
    expect(requests).toEqual([{ q: "schema", mode: "keyword", type: "repo" }]);
  });

  it("asks once for the same request, however often it is read", async () => {
    const reg = start();
    reg.mount(SearchAtoms.results({ q: "rust", mode: "hybrid" }));
    reg.mount(SearchAtoms.results({ q: "rust", mode: "hybrid" }));
    await vi.advanceTimersByTimeAsync(0);
    expect(requests).toEqual([{ q: "rust", mode: "hybrid" }]);
  });

  it("holds the decoded hits", async () => {
    const reg = start();
    const atom = SearchAtoms.results({ q: "rust", mode: "hybrid" });
    reg.mount(atom);
    await vi.advanceTimersByTimeAsync(0);
    const result = reg.get(atom);
    expect(result?._tag).toBe("Success");
    expect(result?._tag === "Success" && result.value.hits.map((hit) => hit.link.id)).toEqual([
      "a",
    ]);
  });
});

describe("recent searches", () => {
  const startRecent = () => {
    registry = ApiTesting.makeRegistry(
      {},
      { initialValues: [[SearchAtoms.recentLayer, PlatformTesting.layerRecentSearches]] },
    );
    registry.mount(SearchAtoms.recent);
    return registry;
  };
  const queries = (reg: AtomRegistry.AtomRegistry) => {
    const result = reg.get(SearchAtoms.recent);
    return result._tag === "Success" ? result.value.map((entry) => entry.query) : undefined;
  };

  it("remembers searches newest first, and forgets one", async () => {
    const reg = startRecent();
    await vi.advanceTimersByTimeAsync(0);
    expect(queries(reg)).toEqual([]);

    reg.set(SearchAtoms.remember, "rust");
    await vi.advanceTimersByTimeAsync(0);
    reg.set(SearchAtoms.remember, " economics video ");
    await vi.advanceTimersByTimeAsync(0);
    expect(queries(reg)).toEqual(["economics video", "rust"]);

    reg.set(SearchAtoms.forget, "rust");
    await vi.advanceTimersByTimeAsync(0);
    expect(queries(reg)).toEqual(["economics video"]);
  });
});
