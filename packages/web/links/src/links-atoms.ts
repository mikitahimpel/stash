import type * as LinksGroup from "@stash/contracts-api/links";
import * as Link from "@stash/contracts-domain/link";
import * as Tag from "@stash/contracts-domain/tag";
import * as ApiAtoms from "@stash/web-api-client/api-atoms";
import * as Option from "effect/Option";
import * as Atom from "effect/reactivity/Atom";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import * as Schema from "effect/Schema";

/**
 * `unseen` lists the links still in status `new`, `recent` every link but the archived ones, and
 * `all` every link. Each is newest first.
 */
export const Feed = Schema.Literals(["unseen", "recent", "all"]);
export type Feed = typeof Feed.Type;

/** What the list page shows. It lives in the URL query (`?feed=unseen&tag=go&type=video`). */
export interface Filters {
  readonly feed: Feed;
  readonly tag: Tag.TagName | undefined;
  readonly type: Link.LinkType | undefined;
}

export const defaultFilters: Filters = { feed: "recent", tag: undefined, type: undefined };

/** The shape of vue-router's `route.query`. */
export type Query = Readonly<Record<string, string | null | ReadonlyArray<string | null>>>;

const first = (value: Query[string] | undefined): string | undefined => {
  const raw = typeof value === "string" || value == null ? value : value[0];
  return raw ?? undefined;
};

const decode =
  <A, I>(schema: Schema.Codec<A, I>) =>
  (value: string | undefined): A | undefined =>
    value === undefined
      ? undefined
      : Option.getOrUndefined(Schema.decodeUnknownOption(schema)(value));

/** Reads the filters from a route query. Missing or invalid values fall back to the defaults. */
export const fromQuery = (query: Query): Filters => ({
  feed: decode(Feed)(first(query.feed)) ?? defaultFilters.feed,
  tag: decode(Tag.TagName)(first(query.tag)),
  type: decode(Link.LinkType)(first(query.type)),
});

/** The route query for `filters`. Defaults are left out, so the plain feed is just `/links`. */
export const toQuery = (filters: Filters): Record<string, string> => ({
  ...(filters.feed === defaultFilters.feed ? {} : { feed: filters.feed }),
  ...(filters.tag === undefined ? {} : { tag: filters.tag }),
  ...(filters.type === undefined ? {} : { type: filters.type }),
});

/** The `GET /links` query for one page of `filters`. */
export const listQuery = (filters: Filters, cursor?: string): LinksGroup.ListLinksQuery => ({
  sort: "recent",
  ...(filters.feed === "unseen" ? { seen: false } : {}),
  ...(filters.tag === undefined ? {} : { tag: filters.tag }),
  ...(filters.type === undefined ? {} : { type: filters.type }),
  ...(cursor === undefined ? {} : { cursor }),
});

/**
 * Whether `link` belongs on the page of `filters`. `GET /links` can't leave out one status, so the
 * `recent` feed drops the archived links from each page it loads.
 */
export const shows = (filters: Filters, link: Link.Link): boolean =>
  filters.feed !== "recent" || link.status !== "archived";

// Families memoize by argument, and objects compare by reference, so the feed is keyed by the
// serialized filters.
const feedByKey = Atom.family((key: string) => {
  const filters = JSON.parse(key) as Filters;
  return ApiAtoms.pages(["links"], (client, cursor) =>
    client.links.list({ query: listQuery(filters, cursor) }),
  );
});

/**
 * The links that match `filters`, one page at a time (infinite scroll): reading loads the first
 * page and each write appends the next. It starts over whenever a links mutation succeeds.
 */
export const feed = (filters: Filters) =>
  feedByKey(JSON.stringify({ feed: filters.feed, tag: filters.tag, type: filters.type }));

/** One link, for the details page. */
export const details = Atom.family((id: Link.LinkId) =>
  ApiAtoms.query(["links"], (client) => client.links.get({ params: { id } })),
);

/** Moves a link to another status (mark seen, done, archive). */
export const setStatus = ApiAtoms.mutation(
  ["links"],
  (client, { id, status }: { readonly id: Link.LinkId; readonly status: Link.LinkStatus }) =>
    client.links.update({ params: { id }, payload: { status } }),
);

/** Saves a link. The feed reloads and picks it up. */
export const saveLink = ApiAtoms.mutation(["links"], (client, url: Link.Url) =>
  client.links.save({ payload: { url } }),
);

const isUrl = Schema.is(Link.Url);

/** The URL in what was typed, assuming `https://` when it has no scheme. */
export const parseUrl = (text: string): Link.Url | undefined => {
  const trimmed = text.trim();
  const url = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return isUrl(url) && URL.canParse(url) ? url : undefined;
};

/** A link on its way into the feed. `saved` once the api has it. */
export interface PendingLink {
  readonly key: number;
  readonly url: Link.Url;
  readonly saved: boolean;
}

/** The optimistic rows: a link stays here from the save until the feed has reloaded around it. */
export const pending: Atom.Writable<ReadonlyArray<PendingLink>> = Atom.make<
  ReadonlyArray<PendingLink>
>([]).pipe(Atom.keepAlive);

let nextPendingKey = 0;

export const addPending = (registry: AtomRegistry.AtomRegistry, url: Link.Url): PendingLink => {
  const entry = { key: nextPendingKey++, url, saved: false };
  registry.update(pending, (all) => [entry, ...all]);
  return entry;
};

export const markSaved = (registry: AtomRegistry.AtomRegistry, key: number): void =>
  registry.update(pending, (all) =>
    all.map((entry) => (entry.key === key ? { ...entry, saved: true } : entry)),
  );

export const dropPending = (registry: AtomRegistry.AtomRegistry, key: number): void =>
  registry.update(pending, (all) => all.filter((entry) => entry.key !== key));

/** Drops the links the api has, once the feed has finished loading. */
export const settlePending = (registry: AtomRegistry.AtomRegistry): void => {
  if (registry.get(pending).some((entry) => entry.saved)) {
    registry.update(pending, (all) => all.filter((entry) => !entry.saved));
  }
};

/** The devices, for the source device of each link. */
export const devices = ApiAtoms.query(["devices"], (client) => client.devices.list());

/** Deletes a link. */
export const remove = ApiAtoms.mutation(["links"], (client, id: Link.LinkId) =>
  client.links.remove({ params: { id } }),
);
