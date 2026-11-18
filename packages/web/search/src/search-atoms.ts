import type * as SearchGroup from "@stash/contracts-api/search";
import * as ApiAtoms from "@stash/web-api-client/api-atoms";
import * as WebPlatform from "@stash/web-platform/live";
import * as RecentSearches from "@stash/web-platform/recent-searches";
import type * as Layer from "effect/Layer";
import * as Atom from "effect/reactivity/Atom";
import * as Reactivity from "effect/reactivity/Reactivity";

/** How long typing must pause before the query goes to the URL, and from there to the api. */
export const debounceMillis = 300;

// One query atom per distinct request (the family compares plain objects structurally). Changing
// links refreshes the results, since status and tags take part in the match.
const search = Atom.family((query: SearchGroup.SearchQuery) =>
  ApiAtoms.query(["search", "links"], (client) => client.search.search({ query })),
);

const none = Atom.make(null);

/** The results of `query`, or `null` when there is nothing to search for (`undefined`). */
export const results = (query: SearchGroup.SearchQuery | undefined) =>
  query === undefined ? none : search(query);

/**
 * The `RecentSearches` service of the app. Defaults to the browser's (`localStorage`, from
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
