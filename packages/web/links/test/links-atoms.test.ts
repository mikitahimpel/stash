import { afterEach, describe, expect, it } from "@effect/vitest";
import type * as Link from "@stash/contracts-domain/link";
import type * as Tag from "@stash/contracts-domain/tag";
import * as ApiTesting from "@stash/web-api-client/testing";
import * as Effect from "effect/Effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import * as LinksAtoms from "../src/links-atoms.ts";
import * as Fixtures from "./fixtures.ts";

let registry: AtomRegistry.AtomRegistry | undefined;
const use = (routes: ApiTesting.Routes) => (registry = ApiTesting.makeRegistry(routes));
afterEach(() => {
  registry?.dispose();
  registry = undefined;
});

const economics = "economics" as Tag.TagName;

describe("filters", () => {
  it("reads the defaults from an empty query", () => {
    expect(LinksAtoms.fromQuery({})).toEqual(LinksAtoms.defaultFilters);
  });

  it("reads feed, tag and type, and drops invalid values", () => {
    expect(LinksAtoms.fromQuery({ feed: "unseen", tag: "economics", type: "video" })).toEqual({
      feed: "unseen",
      tag: "economics",
      type: "video",
    });
    expect(LinksAtoms.fromQuery({ feed: "everything", tag: "Upper", type: ["podcast"] })).toEqual(
      LinksAtoms.defaultFilters,
    );
  });

  it("writes only the non-default filters to the query, and reads them back", () => {
    const filters: LinksAtoms.Filters = { feed: "unseen", tag: economics, type: "video" };
    expect(LinksAtoms.toQuery(LinksAtoms.defaultFilters)).toEqual({});
    expect(LinksAtoms.toQuery(filters)).toEqual({
      feed: "unseen",
      tag: "economics",
      type: "video",
    });
    expect(LinksAtoms.fromQuery(LinksAtoms.toQuery(filters))).toEqual(filters);
  });

  it("maps the not-yet-seen feed to seen=false", () => {
    expect(LinksAtoms.listQuery(LinksAtoms.defaultFilters)).toEqual({ sort: "recent" });
    expect(
      LinksAtoms.listQuery({ feed: "unseen", tag: economics, type: "repo" }, "cursor-1"),
    ).toEqual({ sort: "recent", seen: false, tag: "economics", type: "repo", cursor: "cursor-1" });
  });
});

describe("feed", () => {
  it.effect("pages through GET /links with the filters and the cursor", () =>
    Effect.gen(function* () {
      const queries: Array<Record<string, string>> = [];
      const reg = use({
        "GET /links": (request) => {
          const query = Fixtures.query(request);
          queries.push(query);
          return query.cursor === undefined
            ? Fixtures.page([Fixtures.link("a")], "page-2")
            : Fixtures.page([Fixtures.link("b")]);
        },
      });
      const feed = LinksAtoms.feed({ feed: "unseen", tag: economics, type: undefined });
      const unmount = reg.mount(feed);

      yield* AtomRegistry.getResult(reg, feed);
      reg.set(feed, undefined);
      const loaded = yield* AtomRegistry.getResult(reg, feed, { suspendOnWaiting: true });

      expect(loaded.items.map((link) => link.id)).toEqual(["a", "b"]);
      expect(queries).toEqual([
        { sort: "recent", seen: "false", tag: "economics" },
        { sort: "recent", seen: "false", tag: "economics", cursor: "page-2" },
      ]);
      unmount();
    }),
  );

  it("is the same atom for equal filters", () => {
    expect(LinksAtoms.feed({ ...LinksAtoms.defaultFilters })).toBe(
      LinksAtoms.feed(LinksAtoms.defaultFilters),
    );
  });

  it.effect("reloads after a status change", () =>
    Effect.gen(function* () {
      const statuses = new Map([["a", "new"]]);
      const reg = use({
        "GET /links": () =>
          Fixtures.page([...statuses].map(([id, status]) => Fixtures.link(id, { status }))),
        "PATCH /links/:id": (request, { id = "" }) =>
          Effect.map(Fixtures.body(request), (patch) => {
            const status = (patch as { status: string }).status;
            statuses.set(id, status);
            return ApiTesting.json(Fixtures.link(id, { status }));
          }),
      });
      const feed = LinksAtoms.feed(LinksAtoms.defaultFilters);
      const unmount = reg.mount(feed);
      yield* AtomRegistry.getResult(reg, feed);

      reg.set(LinksAtoms.setStatus, { id: "a" as Link.LinkId, status: "done" });
      yield* AtomRegistry.getResult(reg, LinksAtoms.setStatus, { suspendOnWaiting: true });
      const after = yield* AtomRegistry.getResult(reg, feed, { suspendOnWaiting: true });

      expect(after.items.map((link) => link.status)).toEqual(["done"]);
      unmount();
    }),
  );
});
