import type * as Link from "@stash/contracts-domain/link";
import type * as LinkEvent from "@stash/contracts-domain/link-event";
import * as DateTime from "effect/DateTime";
import * as Atom from "effect/reactivity/Atom";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";

// What the live stream said about links, laid over every cached api answer (see `revalidated` in
// `api-atoms.ts`): a link that changed is replaced where it stands, in any list, search result or
// details answer, and a deleted one leaves its lists. Nothing is asked for again, so nothing
// reloads or moves.
//
// A link no list holds yet (one saved a moment ago on another device) is put into the lists that
// ask for it (`pages` with `accepts`), at its place by the time it was saved (see `insert`).
//
// The overlay never goes stale. Of two copies of a link the one with the later `updatedAt` is
// current, so an answer that is newer than a patch simply wins, and a patch that is newer than an
// answer (a page cached a minute ago, read again) is applied to it.

/** What is known about one link from the stream. */
export type Patch =
  | {
      readonly _tag: "Updated";
      readonly link: Link.Link;
      /** When this tab learned it, in epoch ms by its own clock. */
      readonly at: number;
    }
  | { readonly _tag: "Deleted" };

export type Patches = ReadonlyMap<Link.LinkId, Patch>;

/** The most links the overlay remembers. The oldest patch goes first. */
export const maxPatches = 500;

/** The patches of a registry, newest last. */
export const state: Atom.Writable<Patches> = Atom.make<Patches>(new Map()).pipe(Atom.keepAlive);

const millis = (link: Link.Link): number | undefined =>
  link.updatedAt === undefined ? undefined : DateTime.toEpochMillis(link.updatedAt);

/** Whether `incoming` should replace `held`: it is later, or one of the two carries no time. */
export const isNewer = (incoming: Link.Link, held: Link.Link): boolean => {
  const a = millis(incoming);
  const b = millis(held);
  return a === undefined || b === undefined || a > b;
};

const isPlain = (value: unknown): value is Readonly<Record<string, unknown>> => {
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
};

// A decoded `Link` (or a struct that extends one, such as a `SavedLink`), by its shape: api
// answers are plain data, and nothing else in them has these fields.
const isLink = (value: unknown): value is Link.Link =>
  isPlain(value) &&
  typeof value["id"] === "string" &&
  typeof value["url"] === "string" &&
  typeof value["status"] === "string" &&
  "enrichedAt" in value &&
  Array.isArray(value["tags"]);

const isDeleted = (value: unknown, patches: Patches): boolean =>
  isLink(value) && patches.get(value.id)?._tag === "Deleted";

// An item of a list goes with its deleted link: the link itself, or a row around it (a search hit).
const isDeletedItem = (item: unknown, patches: Patches): boolean =>
  isDeleted(item, patches) ||
  (isPlain(item) && !isLink(item) && Object.values(item).some((v) => isDeleted(v, patches)));

/**
 * `value` with the patches applied, at any depth. Parts without a patched link are returned as
 * they are (the same objects), so a reader sees a change only where there is one.
 */
export const apply = <A>(value: A, patches: Patches): A => {
  if (patches.size === 0) return value;
  return walk(value, patches) as A;
};

const walk = (value: unknown, patches: Patches): unknown => {
  if (Array.isArray(value)) {
    let changed = false;
    const next: Array<unknown> = [];
    for (const item of value as ReadonlyArray<unknown>) {
      if (isDeletedItem(item, patches)) {
        changed = true;
        continue;
      }
      const walked = walk(item, patches);
      if (walked !== item) changed = true;
      next.push(walked);
    }
    return changed ? next : value;
  }
  if (isLink(value)) {
    const patch = patches.get(value.id);
    // The fields of the link are replaced; what a struct adds to it (`created`) stays.
    return patch?._tag === "Updated" && isNewer(patch.link, value)
      ? { ...value, ...patch.link }
      : value;
  }
  if (!isPlain(value)) return value;
  let next: Record<string, unknown> | undefined;
  for (const [key, item] of Object.entries(value)) {
    const walked = walk(item, patches);
    if (walked !== item) (next ??= { ...value })[key] = walked;
  }
  return next ?? value;
};

/**
 * How long before a list's answer arrived a patch may have come and still be inserted into it, in
 * ms: a save that was committed while the list's request was on its way is not in that answer.
 */
export const insertGraceMillis = 10_000;

const created = (link: Link.Link): number => DateTime.toEpochMillis(link.createdAt);

/**
 * `items` (a newest-first list of links, as far as it is loaded) with the links the stream
 * brought that it does not hold: each one `accepts` takes, at its place by `createdAt`. Returns
 * `items` itself when there is none.
 *
 * Only what is certain goes in. A link older than the last loaded one belongs to a page that is
 * not loaded yet (unless the list is `done`). A patch that came well before the answer
 * (`answeredAt`, epoch ms) is left out too: the api did not list that link then, so it was
 * deleted or changed since, in a gap of the stream.
 */
export const insert = <A extends Link.Link>(
  items: ReadonlyArray<A>,
  options: {
    readonly done: boolean;
    readonly patches: Patches;
    readonly accepts: (link: Link.Link) => boolean;
    readonly answeredAt: number;
  },
): ReadonlyArray<A> => {
  const { patches, accepts } = options;
  if (patches.size === 0) return items;
  const held = new Set<string>(items.map((item) => item.id));
  const last = items.at(-1);
  const oldest = options.done || last === undefined ? -Infinity : created(last);
  const fresh: Array<Link.Link> = [];
  for (const patch of patches.values()) {
    if (patch._tag !== "Updated" || held.has(patch.link.id)) continue;
    if (patch.at < options.answeredAt - insertGraceMillis) continue;
    if (created(patch.link) < oldest || !accepts(patch.link)) continue;
    fresh.push(patch.link);
  }
  if (fresh.length === 0) return items;
  fresh.sort((a, b) => created(b) - created(a));
  const next: Array<A> = [];
  let i = 0;
  for (const item of items) {
    // A link saved at the same instant as a listed one goes after it: the list keeps its order.
    while (i < fresh.length && created(fresh[i]!) > created(item)) next.push(fresh[i++] as A);
    next.push(item);
  }
  while (i < fresh.length) next.push(fresh[i++] as A);
  return next;
};

/** The ids of the links in `value` that enrichment has not reached yet, at any depth. */
export const pendingIds = (
  value: unknown,
  into: Set<Link.LinkId> = new Set(),
): Set<Link.LinkId> => {
  if (Array.isArray(value)) {
    for (const item of value as ReadonlyArray<unknown>) pendingIds(item, into);
  } else if (isLink(value)) {
    if (value.enrichedAt === null) into.add(value.id);
  } else if (isPlain(value)) {
    for (const item of Object.values(value)) pendingIds(item, into);
  }
  return into;
};

const put = (registry: AtomRegistry.AtomRegistry, id: Link.LinkId, patch: Patch): void =>
  registry.update(state, (patches) => {
    const next = new Map(patches);
    // Deleting first moves the link to the end: the newest patch is the last to be dropped.
    next.delete(id);
    next.set(id, patch);
    for (const oldest of next.keys()) {
      if (next.size <= maxPatches) break;
      next.delete(oldest);
    }
    return next;
  });

/** Lays `link` over every cached answer, unless a later copy is known already. */
export const update = (registry: AtomRegistry.AtomRegistry, link: Link.Link): void => {
  const known = registry.get(state).get(link.id);
  if (known?._tag === "Deleted") return;
  if (known?._tag === "Updated" && !isNewer(link, known.link)) return;
  put(registry, link.id, { _tag: "Updated", link, at: Date.now() });
};

/** Takes the link out of every cached list. */
export const remove = (registry: AtomRegistry.AtomRegistry, id: Link.LinkId): void =>
  put(registry, id, { _tag: "Deleted" });

/** Applies one event of the live stream. `stream.ready` changes nothing. */
export const record = (registry: AtomRegistry.AtomRegistry, event: LinkEvent.LinkEvent): void => {
  if (event.type === "link.updated") update(registry, event.link);
  else if (event.type === "link.deleted") remove(registry, event.id);
};

// The links each query on screen is still waiting on, per registry. `revalidated` keeps it.
const waiting = new WeakMap<AtomRegistry.AtomRegistry, Map<object, ReadonlySet<Link.LinkId>>>();

/** Notes the pending links of one query's current answer. `undefined` forgets the query. */
export const track = (registry: AtomRegistry.AtomRegistry, query: object, value: unknown): void => {
  let queries = waiting.get(registry);
  if (queries === undefined) waiting.set(registry, (queries = new Map()));
  if (value === undefined) queries.delete(query);
  else queries.set(query, pendingIds(value));
};

/** The links the queries being read right now are still waiting on. */
export const pending = (registry: AtomRegistry.AtomRegistry): ReadonlySet<Link.LinkId> => {
  const ids = new Set<Link.LinkId>();
  for (const query of waiting.get(registry)?.values() ?? []) for (const id of query) ids.add(id);
  return ids;
};
