import type * as SearchGroup from "@stash/contracts-api/search";
import type * as Link from "@stash/contracts-domain/link";
import * as ApiAtoms from "@stash/web-api-client/api-atoms";
import * as Atom from "effect/reactivity/Atom";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
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

export const tag: Atom.Writable<string> = Atom.make(SearchRequest.emptyForm.tag).pipe(
  Atom.keepAlive,
);

// Typing is debounced. Mode and filter changes (chips) apply at once.
const debouncedQ = Atom.debounce(q, debounceMillis);

/** The parameters of the current search, or `undefined` while the query is blank. */
export const request: Atom.Atom<SearchGroup.SearchQuery | undefined> = Atom.make((get) =>
  SearchRequest.fromForm({
    q: get(debouncedQ),
    mode: get(mode),
    type: get(type),
    tag: get(tag),
  }),
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

/** How many recent links the timeline draws behind the matches: one page of `GET /links`. */
/** Runs the current search again, for the page's Retry. */
export const retry = (registry: AtomRegistry.AtomRegistry): void => {
  const query = registry.get(request);
  if (query !== undefined) registry.refresh(search(query));
};

export const savedLimit = 100;

/**
 * The most recent saved links, for the timeline's background dots and the tag chips. One page of
 * an existing endpoint keeps it cheap.
 */
export const saved = ApiAtoms.query(["links"], (client) =>
  client.links.list({ query: { sort: "recent", limit: savedLimit } }),
);

/** Marks a link as seen. The results refresh, since a links change invalidates the search. */
export const markSeen = ApiAtoms.mutation(["links"], (client, id: Link.LinkId) =>
  client.links.update({ params: { id }, payload: { status: "seen" } }),
);
