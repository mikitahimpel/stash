import type * as StashApi from "@stash/contracts-api/api";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import type * as HttpApiClient from "effect/http-api/HttpApiClient";
import * as HttpClientError from "effect/http/HttpClientError";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import * as Reactivity from "effect/reactivity/Reactivity";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
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

/** How long a query keeps its last result once no page reads it. */
export const idleTTL: Duration.Duration = Duration.minutes(10);

// When each query was last asked for a fresh answer, per registry: by its first load, by the
// refresh behind a page that opens it, or by `prefetch`.
const askedAt = new WeakMap<AtomRegistry.AtomRegistry, WeakMap<Atom.Atom<any>, number>>();
const lastAsked = (registry: AtomRegistry.AtomRegistry, atom: Atom.Atom<any>): number | undefined =>
  askedAt.get(registry)?.get(atom);
const markAsked = (registry: AtomRegistry.AtomRegistry, atom: Atom.Atom<any>): void => {
  let times = askedAt.get(registry);
  if (times === undefined) askedAt.set(registry, (times = new WeakMap()));
  times.set(atom, Date.now());
};

// Stale-while-revalidate. The result outlives the page that reads it (for `idleTTL`), so a page that
// opens again shows the cached success at once, and a refresh runs behind it. While that refresh
// runs the result stays a `Success` (with `waiting`), so pages keep their rows instead of a
// skeleton. A cached failure is not retried by itself: pages offer Retry for that.
const revalidated = <A extends Atom.Atom<AsyncResult.AsyncResult<any, any>>>(atom: A) => {
  const source = Atom.setIdleTTL(atom, idleTTL);
  const self: Atom.Atom<any> = Atom.transform(
    source,
    (get) => {
      const current = get.once(source);
      get.subscribe(source, (value) => get.setSelf(value));
      if (AsyncResult.isInitial(current)) markAsked(get.registry, self);
      if (AsyncResult.isSuccess(current) && !current.waiting) {
        markAsked(get.registry, self);
        let active = true;
        get.addFinalizer(() => (active = false));
        get.registry.schedulerAsync.makeDispatcher().scheduleTask(() => {
          if (active) get.refresh(source);
        }, 0);
      }
      return current;
    },
    { initialValueTarget: source },
  );
  return self as unknown as A;
};

/**
 * An atom that runs `run` against the client and holds its result. It runs again whenever one of
 * `keys` is invalidated, for example by a `mutation`, and in the background whenever a page starts
 * reading it again (stale-while-revalidate, see `idleTTL`).
 *
 * ```ts
 * const recent = ApiAtoms.query(["links"], (client) => client.links.list({ query: { sort: "recent" } }));
 * ```
 */
export const query = <A, E>(
  keys: Keys,
  run: (client: Client) => Effect.Effect<A, E>,
): Atom.Atom<AsyncResult.AsyncResult<A, Exclude<E, Defect>>> =>
  revalidated(
    StashApiClient.runtime.factory.withReactivity(keys)(
      StashApiClient.runtime.atom(dieOnDefect(StashApiClient.use(run))),
    ),
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

/** One page of a cursor-paginated endpoint. `nextCursor` is null on the last page. */
export interface Page<A> {
  readonly items: ReadonlyArray<A>;
  readonly nextCursor: string | null;
}

/**
 * A pull atom over a cursor-paginated endpoint, for infinite scroll. Reading it loads the first
 * page; each write (`set(atom, undefined)`) appends the next one. `done` turns true on the pull
 * after the last page, which answers without a request. `run` gets the cursor of the page to load (`undefined` for the first). Like `query`, it
 * starts over from the first page whenever one of `keys` is invalidated, and, like `query`, keeps its
 * pages while no page reads it and reloads in the background when one does again. An empty result fails
 * with `NoSuchElementError`.
 *
 * ```ts
 * const recent = ApiAtoms.pages(["links"], (client, cursor) =>
 *   client.links.list({ query: { sort: "recent", ...(cursor ? { cursor } : {}) } }),
 * );
 * ```
 */
export const pages = <A, E>(
  keys: Keys,
  run: (client: Client, cursor: string | undefined) => Effect.Effect<Page<A>, E>,
): Atom.Writable<Atom.PullResult<A, Exclude<E, Defect>>, void> =>
  revalidated(
    StashApiClient.runtime.factory.withReactivity(keys)(
      StashApiClient.runtime.pull(
        Stream.paginate(undefined as string | undefined, (cursor) =>
          dieOnDefect(StashApiClient.use((client) => run(client, cursor))).pipe(
            Effect.map((page) => [page.items, Option.fromNullishOr(page.nextCursor)] as const),
          ),
        ),
      ),
    ),
  );

/** How long `prefetch` keeps reading its queries, in ms: the time a page has to take them over. */
export const prefetchHoldMillis = 5000;

/**
 * How old an answer may be, in ms, before `prefetch` asks again: long enough that the page which
 * opens right after a hover doesn't ask twice, short enough that the next hover brings what
 * changed meanwhile (a link saved on another device).
 */
export const prefetchFreshMillis = 1500;

interface Hold {
  readonly unmount: () => void;
  timer: ReturnType<typeof setTimeout>;
}
// One hold per query and registry: a second `prefetch` renews it instead of adding another.
const holds = new WeakMap<AtomRegistry.AtomRegistry, Map<Atom.Atom<any>, Hold>>();

/**
 * Loads `queries` (`query` or `pages` atoms) ahead of the page that reads them, for a tab the
 * pointer is on: what is not cached is fetched, and a cached answer older than
 * `prefetchFreshMillis` is asked for again, whether or not something reads the query right now.
 * The queries stay read for `prefetchHoldMillis` after that, so the page that opens meanwhile
 * shows the answer without asking the api a second time. A `prefetch` that finds its answers
 * fresh changes nothing, so the hold of a query ends `prefetchHoldMillis` after it was last
 * asked, however often the pointer comes back. Returns the function that lets go of the queries
 * sooner.
 */
export const prefetch = (
  registry: AtomRegistry.AtomRegistry,
  queries: ReadonlyArray<Atom.Atom<AsyncResult.AsyncResult<any, any>>>,
): (() => void) => {
  let held = holds.get(registry);
  if (held === undefined) holds.set(registry, (held = new Map()));
  const mine = held;
  const release = (query: Atom.Atom<any>) => {
    const hold = mine.get(query);
    if (hold === undefined) return;
    mine.delete(query);
    clearTimeout(hold.timer);
    hold.unmount();
  };
  for (const query of queries) {
    const before = lastAsked(registry, query);
    // Mounting loads a query nothing has read yet, and refreshes one that lost its last reader
    // (`revalidated`); either way it is asked now.
    const unmount = mine.has(query) ? undefined : registry.mount(query);
    const result = registry.get(query);
    const stale =
      before !== undefined &&
      lastAsked(registry, query) === before &&
      Date.now() - before >= prefetchFreshMillis;
    // Already read by a page or an earlier prefetch, so mounting asked nothing: ask here.
    if (stale && AsyncResult.isSuccess(result) && !result.waiting) {
      markAsked(registry, query);
      registry.refresh(query);
    }
    const asked = unmount !== undefined || lastAsked(registry, query) !== before;
    const hold = mine.get(query);
    if (hold === undefined) {
      if (unmount !== undefined) {
        mine.set(query, { unmount, timer: setTimeout(() => release(query), prefetchHoldMillis) });
      }
    } else if (asked) {
      clearTimeout(hold.timer);
      hold.timer = setTimeout(() => release(query), prefetchHoldMillis);
    }
  }
  return () => {
    for (const query of queries) release(query);
  };
};
