import type * as StashApi from "@stash/contracts-api/api";
import * as Effect from "effect/Effect";
import type * as HttpApiClient from "effect/http-api/HttpApiClient";
import * as HttpClientError from "effect/http/HttpClientError";
import type * as AsyncResult from "effect/reactivity/AsyncResult";
import type * as Atom from "effect/reactivity/Atom";
import * as Reactivity from "effect/reactivity/Reactivity";
import * as Schema from "effect/Schema";
import { StashApiClient } from "./stash-api-client.ts";

/** The typed client: one object per api group, one method per endpoint. */
export type Client = HttpApiClient.ForApi<typeof StashApi.StashApi>;

/** An api group name (`"links"`, `"tabs"`, ...). Group names are the default reactivity keys. */
export type Group = keyof Client;

/**
 * Reactivity keys. By convention a query depends on the groups it reads and a mutation
 * invalidates the groups it changes, so `["links"]` refreshes every links query. A record such as
 * `{ links: [id] }` targets single entities.
 */
export type Keys = ReadonlyArray<Group> | Reactivity.KeysInput;

/** Transport and decoding failures. They are bugs or outages, not domain errors. */
type Defect = HttpClientError.HttpClientError | Schema.SchemaError;

// Same as `AtomHttpApi`: transport and decoding failures become defects, so the error channel holds
// only the endpoint's domain errors (`NotFound`, `Unauthorized`, ...).
const dieOnDefect = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, Exclude<E, Defect>, R> =>
  Effect.catch(effect, (error) =>
    HttpClientError.isHttpClientError(error) || Schema.isSchemaError(error)
      ? Effect.die(error)
      : Effect.fail(error as Exclude<E, Defect>),
  );

/**
 * An atom that runs `run` against the client and holds its result. It runs again whenever one of
 * `keys` is invalidated, for example by a `mutation`.
 *
 * ```ts
 * const recent = ApiAtoms.query(["links"], (client) => client.links.list({ query: { sort: "recent" } }));
 * ```
 */
export const query = <A, E>(
  keys: Keys,
  run: (client: Client) => Effect.Effect<A, E>,
): Atom.Atom<AsyncResult.AsyncResult<A, Exclude<E, Defect>>> =>
  StashApiClient.runtime.factory.withReactivity(keys)(
    StashApiClient.runtime.atom(dieOnDefect(StashApiClient.use(run))),
  );

/**
 * A function atom that runs `run` with its argument and, once it succeeds, invalidates
 * `invalidates`, so the queries that depend on those keys refresh.
 *
 * ```ts
 * const archive = ApiAtoms.mutation(["links"], (client, id: LinkId) =>
 *   client.links.update({ params: { id }, payload: { status: "archived" } }),
 * );
 * ```
 */
export const mutation = <Arg, A, E>(
  invalidates: Keys,
  run: (client: Client, arg: Arg) => Effect.Effect<A, E>,
): Atom.AtomResultFn<Arg, A, Exclude<E, Defect>> =>
  StashApiClient.runtime.fn<Arg>()((arg) =>
    dieOnDefect(StashApiClient.use((client) => run(client, arg))).pipe(
      Reactivity.mutation(invalidates),
    ),
  );
