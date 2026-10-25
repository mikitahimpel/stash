import * as PlatformTesting from "@stash/web-platform/testing";
import * as Effect from "effect/Effect";
import type * as HttpClient from "effect/http/HttpClient";
import type * as HttpClientRequest from "effect/http/HttpClientRequest";
import type * as Layer from "effect/Layer";
import type * as Atom from "effect/reactivity/Atom";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import * as StashApiClient from "./stash-api-client.ts";

/** Answers one stubbed endpoint. */
export type Handler = (
  request: HttpClientRequest.HttpClientRequest,
  params: Readonly<Record<string, string>>,
) => Response | Effect.Effect<Response>;

/**
 * Stubbed endpoints keyed by `"<METHOD> <path>"` as the contract declares them, for example
 * `"GET /links"` or `"PATCH /links/:id"`. `:name` segments match any value and arrive in `params`.
 * The query string and the base URL are ignored when matching.
 */
export type Routes = Readonly<Record<string, Handler>>;

const compile = (routes: Routes) =>
  Object.entries(routes).map(([key, handler]) => {
    const [method = "", path = ""] = key.split(" ");
    const names: Array<string> = [];
    const source = path.replace(/:([^/]+)/g, (_, name: string) => {
      names.push(name);
      return "([^/]+)";
    });
    return { method, pattern: new RegExp(`^${source}$`), names, handler };
  });

/**
 * A stub api: every request is answered by the matching route, and a request no route matches
 * gets a 404 with no body (which the client reports as a defect). Responses go through the real
 * client, so they are decoded against the contract.
 */
export const layer = (routes: Routes): Layer.Layer<HttpClient.HttpClient> => {
  const compiled = compile(routes);
  return PlatformTesting.layerHttpClient((request) =>
    Effect.suspend(() => {
      const { pathname } = new URL(request.url, "http://localhost");
      for (const route of compiled) {
        const match = route.method === request.method ? route.pattern.exec(pathname) : null;
        if (match === null) continue;
        const params = Object.fromEntries(
          route.names.map((name, i) => [name, decodeURIComponent(match[i + 1] ?? "")]),
        );
        const response = route.handler(request, params);
        return Effect.isEffect(response) ? response : Effect.succeed(response);
      }
      return Effect.succeed(new Response(null, { status: 404 }));
    }),
  );
};

/**
 * An `AtomRegistry` whose api client talks to the stub `routes`. Use it to read query atoms and
 * run mutation atoms in tests. Dispose it at the end of the test.
 */
export const makeRegistry = (
  routes: Routes,
  options?: {
    readonly initialValues?: Iterable<readonly [Atom.Atom<any>, any]>;
  },
): AtomRegistry.AtomRegistry =>
  AtomRegistry.make({
    initialValues: [[StashApiClient.transport, layer(routes)], ...(options?.initialValues ?? [])],
  });

/** A JSON response, `200` unless `status` says otherwise. */
export const json = (body: unknown, status = 200): Response => Response.json(body, { status });

/** The 401 the api answers when the session is missing or expired. */
export const unauthorized = (message = "Not signed in"): Response =>
  json({ _tag: "Unauthorized", message }, 401);
