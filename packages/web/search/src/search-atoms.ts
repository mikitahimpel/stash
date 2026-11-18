import type * as SearchGroup from "@stash/contracts-api/search";
import type * as Link from "@stash/contracts-domain/link";
import * as ApiAtoms from "@stash/web-api-client/api-atoms";
import * as WebPlatform from "@stash/web-platform/live";
import * as RecentSearches from "@stash/web-platform/recent-searches";
import * as DateTime from "effect/DateTime";
import type * as Layer from "effect/Layer";
import * as Atom from "effect/reactivity/Atom";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import * as Reactivity from "effect/reactivity/Reactivity";
import * as SearchRequest from "./search-request.ts";

/** How long typing must pause before the query is sent. */
export const debounceMillis = 300;

/** The text in the search box, as typed. */
export const q: Atom.Writable<string> = Atom.make(SearchRequest.emptyForm.q).pipe(Atom.keepAlive);

export const mode: Atom.Writable<SearchGroup.SearchMode> = Atom.make(
  SearchRequest.emptyForm.mode,
).pipe(Atom.keepAlive);

export const type: Atom.Writable<Link.LinkType | ""> = Atom.make(SearchRequest.emptyForm.type).pipe(
  Atom.keepAlive,
);

/** The id of the device to keep links from, or `""` for any. */
export const device: Atom.Writable<string> = Atom.make(SearchRequest.emptyForm.device).pipe(
  Atom.keepAlive,
);

export const range: Atom.Writable<SearchRequest.Range | ""> = Atom.make(
  SearchRequest.emptyForm.range,
).pipe(Atom.keepAlive);

/** The tag picked on a row, or `""`. */
export const tag: Atom.Writable<string> = Atom.make(SearchRequest.emptyForm.tag).pipe(
  Atom.keepAlive,
);

// Typing is debounced. Mode and filter changes apply at once.
const debouncedQ = Atom.debounce(q, debounceMillis);

/** The form with the query as typed: what the page's own lists are filtered by. */
export const form: Atom.Atom<SearchRequest.Form> = Atom.make((get) => ({
  q: get(q),
  mode: get(mode),
  type: get(type),
  device: get(device),
  range: get(range),
  tag: get(tag),
}));

/** The parameters of the current search, or `undefined` while the query is blank. */
export const request: Atom.Atom<SearchGroup.SearchQuery | undefined> = Atom.make((get) =>
  SearchRequest.fromForm({ ...get(form), q: get(debouncedQ) }, DateTime.nowUnsafe()),
);

// One query atom per distinct request (the family compares plain objects structurally). Changing
// links refreshes the results, since status and tags take part in the match.
const search = Atom.family((query: SearchGroup.SearchQuery) =>
  ApiAtoms.query(["search", "links"], (client) => client.search.search({ query })),
);

/** The results of the current search, or `null` while there is nothing to search for. */
export const results = Atom.make((get) => {
  const query = get(request);
  return query === undefined ? null : get(search(query));
});

/** Runs the current search again, for the page's Retry. */
export const retry = (registry: AtomRegistry.AtomRegistry): void => {
  const query = registry.get(request);
  if (query !== undefined) registry.refresh(search(query));
};

/** How many recent links the page loads for its "Recently saved" list: one small page. */
export const savedLimit = 20;

/** The most recent saved links, shown before anything is typed. */
export const saved = ApiAtoms.query(["links"], (client) =>
  client.links.list({ query: { sort: "recent", limit: savedLimit } }),
);

/** The devices, for the Device filter and the source device of each result. */
export const devices = ApiAtoms.query(["devices"], (client) => client.devices.list());

/** Marks a link as seen. The results refresh, since a links change invalidates the search. */
export const markSeen = ApiAtoms.mutation(["links"], (client, id: Link.LinkId) =>
  client.links.update({ params: { id }, payload: { status: "seen" } }),
);

/**
 * The `RecentSearches` service of the page. Defaults to the browser's (`localStorage`, from
 * `@stash/web-platform`). Tests replace it per registry with `@stash/web-platform/testing`.
 */
export const recentLayer: Atom.Writable<Layer.Layer<RecentSearches.RecentSearches>> = Atom.make(
  WebPlatform.layerRecentSearches,
).pipe(Atom.keepAlive);

const recentRuntime = Atom.runtime((get) => get(recentLayer));
const recentKeys = ["recent-searches"];

/** The searches made on this device, newest first. */
export const recent = recentRuntime.factory.withReactivity(recentKeys)(
  recentRuntime.atom(RecentSearches.RecentSearches.use((searches) => searches.list)),
);

/** Remembers a search the user acted on (↵, or opening a result). A blank one is ignored. */
export const remember = recentRuntime.fn<string>()((query) =>
  RecentSearches.RecentSearches.use((searches) => searches.add(query)).pipe(
    Reactivity.mutation(recentKeys),
  ),
);

/** Takes one search off the list. */
export const forget = recentRuntime.fn<string>()((query) =>
  RecentSearches.RecentSearches.use((searches) => searches.remove(query)).pipe(
    Reactivity.mutation(recentKeys),
  ),
);
