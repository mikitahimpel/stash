import * as ApiTesting from "@stash/web-api-client/testing";
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
  registry.mount(SearchAtoms.results);
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
  it("sends nothing while the query is blank", async () => {
    const reg = start();
    await vi.advanceTimersByTimeAsync(SearchAtoms.debounceMillis * 2);
    expect(reg.get(SearchAtoms.results)).toBeNull();
    expect(requests).toEqual([]);
  });

  it("waits until typing pauses and sends only the last query", async () => {
    const reg = start();
    for (const text of ["r", "ru", "rus", "rust"]) {
      reg.set(SearchAtoms.q, text);
      await vi.advanceTimersByTimeAsync(SearchAtoms.debounceMillis - 50);
    }
    expect(requests).toEqual([]);

    await vi.advanceTimersByTimeAsync(50);
    expect(requests).toEqual([{ q: "rust", mode: "hybrid" }]);
  });

  it("sends the mode and filters as query parameters", async () => {
    const reg = start();
    reg.set(SearchAtoms.mode, "keyword");
    reg.set(SearchAtoms.type, "repo");
    reg.set(SearchAtoms.tag, "Effect");
    reg.set(SearchAtoms.q, "schema");
    await vi.advanceTimersByTimeAsync(SearchAtoms.debounceMillis);
    expect(requests).toEqual([{ q: "schema", mode: "keyword", type: "repo", tag: "effect" }]);
  });

  it("applies a mode change at once, without waiting", async () => {
    const reg = start();
    reg.set(SearchAtoms.q, "rust");
    await vi.advanceTimersByTimeAsync(SearchAtoms.debounceMillis);
    reg.set(SearchAtoms.mode, "semantic");
    await vi.advanceTimersByTimeAsync(0);
    expect(requests).toEqual([
      { q: "rust", mode: "hybrid" },
      { q: "rust", mode: "semantic" },
    ]);
  });

  it("holds the decoded hits", async () => {
    const reg = start();
    reg.set(SearchAtoms.q, "rust");
    await vi.advanceTimersByTimeAsync(SearchAtoms.debounceMillis);
    const result = reg.get(SearchAtoms.results);
    expect(result?._tag).toBe("Success");
    expect(result?._tag === "Success" && result.value.hits.map((hit) => hit.link.id)).toEqual([
      "a",
    ]);
  });
});
