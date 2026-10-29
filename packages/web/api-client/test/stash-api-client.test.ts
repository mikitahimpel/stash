import * as Errors from "@stash/contracts-domain/errors";
import { afterEach, describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as UrlParams from "effect/http/UrlParams";
import * as Option from "effect/Option";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import * as ApiAtoms from "../src/api-atoms.ts";
import * as Testing from "../src/testing.ts";
import * as Unauthenticated from "../src/unauthenticated.ts";
import * as Fixtures from "./fixtures.ts";

let registry: AtomRegistry.AtomRegistry | undefined;
const use = (routes: Testing.Routes) => (registry = Testing.makeRegistry(routes));
afterEach(() => {
  registry?.dispose();
  registry = undefined;
});

const recent = ApiAtoms.query(["links"], (client) =>
  client.links.list({ query: { sort: "recent" } }),
);

describe("StashApiClient", () => {
  it.effect("sends requests to VITE_API_BASE_URL with credentials: include", () =>
    Effect.gen(function* () {
      const seen: Array<{ url: string; credentials: RequestCredentials | undefined }> = [];
      const reg = use({
        "GET /links": (request) =>
          Effect.map(Effect.serviceOption(FetchHttpClient.RequestInit), (init) => {
            seen.push({
              url: request.url,
              credentials: Option.getOrUndefined(init)?.credentials,
            });
            return Testing.json(Fixtures.page("a"));
          }),
      });
      yield* AtomRegistry.getResult(reg, recent);
      expect(seen).toEqual([{ url: "https://api.example.com/links", credentials: "include" }]);
    }),
  );

  // The api's CORS allows only `authorization` and `content-type`: a trace header would fail the
  // browser's preflight, and with it every request.
  it.effect("sends no trace headers", () =>
    Effect.gen(function* () {
      const headers: Array<ReadonlyArray<string>> = [];
      const reg = use({
        "GET /links": (request) => {
          headers.push(Object.keys(request.headers));
          return Testing.json(Fixtures.page("a"));
        },
      });
      yield* AtomRegistry.getResult(reg, recent);
      expect(headers).toHaveLength(1);
      expect(headers[0]).not.toContain("traceparent");
      expect(headers[0]).not.toContain("b3");
    }),
  );

  it.effect("decodes responses against the contract", () =>
    Effect.gen(function* () {
      const reg = use({ "GET /links": () => Testing.json(Fixtures.page("a", "b")) });
      const page = yield* AtomRegistry.getResult(reg, recent);
      expect(page.items.map((link) => link.id)).toEqual(["a", "b"]);
      expect(DateTime.isDateTime(page.items[0]?.createdAt)).toBe(true);
    }),
  );

  it.effect("fails with the endpoint's domain error", () =>
    Effect.gen(function* () {
      const reg = use({
        "GET /links/:id": (_, { id }) =>
          Testing.json({ _tag: "NotFound", resource: "link", id }, 404),
      });
      const missing = ApiAtoms.query(["links"], (client) =>
        client.links.get({ params: { id: "gone" as never } }),
      );
      const error = yield* Effect.flip(AtomRegistry.getResult(reg, missing));
      expect(error).toBeInstanceOf(Errors.NotFound);
      expect(error).toMatchObject({ resource: "link", id: "gone" });
    }),
  );

  it.effect("turns undecodable responses into defects", () =>
    Effect.gen(function* () {
      const reg = use({ "GET /links": () => Testing.json({ items: "not an array" }) });
      const exit = yield* Effect.exit(AtomRegistry.getResult(reg, recent));
      expect(Exit.hasDies(exit)).toBe(true);
    }),
  );

  it.effect("emits unauthenticated on a 401 and fails with Unauthorized", () =>
    Effect.gen(function* () {
      const reg = use({ "GET /links": () => Testing.unauthorized() });
      let events = 0;
      const stop = Unauthenticated.onUnauthenticated(reg, () => events++);
      const error = yield* Effect.flip(AtomRegistry.getResult(reg, recent));
      expect(error).toBeInstanceOf(Errors.Unauthorized);
      expect(events).toBe(1);
      stop();
    }),
  );

  it.effect("does not emit unauthenticated on other statuses", () =>
    Effect.gen(function* () {
      const reg = use({ "GET /links": () => Testing.json(Fixtures.page()) });
      yield* AtomRegistry.getResult(reg, recent);
      expect(reg.get(Unauthenticated.unauthenticated)).toBe(0);
    }),
  );
});

describe("ApiAtoms.mutation", () => {
  it.effect("invalidates the queries of the groups it changes", () =>
    Effect.gen(function* () {
      const statuses = new Map([["a", "new"]]);
      let lists = 0;
      const reg = use({
        "GET /links": () => {
          lists++;
          return Testing.json({
            items: [...statuses].map(([id, status]) => Fixtures.link(id, status)),
            nextCursor: null,
          });
        },
        "PATCH /links/:id": (request, { id }) =>
          Effect.promise(async () => {
            const body = request.body;
            const patch =
              body._tag === "Uint8Array" ? JSON.parse(new TextDecoder().decode(body.body)) : {};
            statuses.set(id ?? "", patch.status);
            return Testing.json(Fixtures.link(id ?? "", patch.status));
          }),
      });
      const archive = ApiAtoms.mutation(["links"], (client, id: string) =>
        client.links.update({ params: { id: id as never }, payload: { status: "archived" } }),
      );
      const unmount = reg.mount(recent);

      const before = yield* AtomRegistry.getResult(reg, recent);
      expect(before.items.map((link) => link.status)).toEqual(["new"]);

      reg.set(archive, "a");
      const updated = yield* AtomRegistry.getResult(reg, archive, { suspendOnWaiting: true });
      expect(updated.status).toBe("archived");

      const after = yield* AtomRegistry.getResult(reg, recent, { suspendOnWaiting: true });
      expect(after.items.map((link) => link.status)).toEqual(["archived"]);
      expect(lists).toBe(2);
      unmount();
    }),
  );

  it.effect("leaves queries of other groups alone", () =>
    Effect.gen(function* () {
      let lists = 0;
      const reg = use({
        "GET /links": () => {
          lists++;
          return Testing.json(Fixtures.page("a"));
        },
        "DELETE /tokens/:id": () => new Response(null, { status: 204 }),
      });
      const revokeToken = ApiAtoms.mutation(["tokens"], (client, id: string) =>
        client.tokens.revoke({ params: { id: id as never } }),
      );
      const unmount = reg.mount(recent);
      yield* AtomRegistry.getResult(reg, recent);
      reg.set(revokeToken, "token-1");
      yield* AtomRegistry.getResult(reg, revokeToken, { suspendOnWaiting: true });
      yield* AtomRegistry.getResult(reg, recent, { suspendOnWaiting: true });
      expect(lists).toBe(1);
      unmount();
    }),
  );
});

describe("ApiAtoms.pages", () => {
  let requests = 0;
  // Three links, two per page; the cursor is the index of the next page's first link.
  const routes: Testing.Routes = {
    "GET /links": (request) => {
      requests++;
      const ids = ["a", "b", "c"];
      const start = Number(
        Option.getOrElse(UrlParams.getFirst(request.urlParams, "cursor"), () => 0),
      );
      const next = start + 2 < ids.length ? String(start + 2) : null;
      return Testing.json({
        items: ids.slice(start, start + 2).map((id) => Fixtures.link(id)),
        nextCursor: next,
      });
    },
  };
  const all = ApiAtoms.pages(["links"], (client, cursor) =>
    client.links.list({ query: cursor === undefined ? {} : { cursor } }),
  );

  it.effect("loads the first page, then appends the next one on each pull", () =>
    Effect.gen(function* () {
      requests = 0;
      const reg = use(routes);
      const unmount = reg.mount(all);

      const first = yield* AtomRegistry.getResult(reg, all);
      expect(first.items.map((link) => link.id)).toEqual(["a", "b"]);
      expect(first.done).toBe(false);

      reg.set(all, undefined);
      const second = yield* AtomRegistry.getResult(reg, all, { suspendOnWaiting: true });
      expect(second.items.map((link) => link.id)).toEqual(["a", "b", "c"]);
      expect(second.done).toBe(false);

      // The last page had no cursor, so this pull ends the stream without a request.
      reg.set(all, undefined);
      const last = yield* AtomRegistry.getResult(reg, all, { suspendOnWaiting: true });
      expect(last.items.map((link) => link.id)).toEqual(["a", "b", "c"]);
      expect(last.done).toBe(true);
      expect(requests).toBe(2);
      unmount();
    }),
  );

  it.effect("fails with NoSuchElementError when there are no items", () =>
    Effect.gen(function* () {
      const reg = use({ "GET /links": () => Testing.json(Fixtures.page()) });
      const error = yield* Effect.flip(AtomRegistry.getResult(reg, all));
      expect(error._tag).toBe("NoSuchElementError");
    }),
  );
});
