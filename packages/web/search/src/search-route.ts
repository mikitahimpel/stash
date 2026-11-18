import type * as SearchGroup from "@stash/contracts-api/search";
import * as SearchRequest from "./search-request.ts";

/** The shape of vue-router's `route.query`. */
export type Query = Readonly<Record<string, string | null | ReadonlyArray<string | null>>>;

/**
 * The part of a search that lives in the URL of the Inbox next to its own filters:
 * `/links?q=rust&mode=keyword&device=<id>&range=week`. The type and the tag are the Inbox's
 * (`type`, `tag`), so they stay when the search is cleared.
 */
export interface State {
  /** The query as typed. Blank means "not searching". */
  readonly q: string;
  readonly mode: SearchGroup.SearchMode;
  /** The id of the device the links were saved from, or `""` for any. */
  readonly device: string;
  readonly range: SearchRequest.Range | "";
}

export const empty: State = {
  q: SearchRequest.emptyForm.q,
  mode: SearchRequest.emptyForm.mode,
  device: SearchRequest.emptyForm.device,
  range: SearchRequest.emptyForm.range,
};

const first = (value: Query[string] | undefined): string => {
  const raw = typeof value === "string" || value == null ? value : value[0];
  return raw ?? "";
};

const isMode = (value: string): value is SearchGroup.SearchMode =>
  SearchRequest.modes.some((mode) => mode.value === value);
const isRange = (value: string): value is SearchRequest.Range =>
  SearchRequest.ranges.some((range) => range.value === value);

/** Reads the search from a route query. Missing or invalid values fall back to `empty`. */
export const fromQuery = (query: Query): State => {
  const mode = first(query["mode"]);
  const range = first(query["range"]);
  return {
    q: first(query["q"]),
    mode: isMode(mode) ? mode : empty.mode,
    device: first(query["device"]),
    range: isRange(range) ? range : empty.range,
  };
};

// The parameters this module owns in the URL.
const own: ReadonlySet<string> = new Set(["q", "mode", "device", "range"]);

/** Whether `state` asks for a search: its query is not blank. */
export const searching = (state: State): boolean => state.q.trim() !== "";

/**
 * `query` with `state` written into it: the other parameters (the Inbox's feed, type and tag) are
 * kept. Defaults are left out, and so is everything once the query is blank, so clearing the
 * field gives the Inbox's own URL back.
 */
export const withState = <V extends Query[string]>(
  query: Readonly<Record<string, V>>,
  state: State,
): Record<string, V | string> => {
  const rest: Record<string, V | string> = Object.fromEntries(
    Object.entries(query).filter(([key]) => !own.has(key)),
  );
  if (!searching(state)) return rest;
  return {
    ...rest,
    q: state.q,
    ...(state.mode === empty.mode ? {} : { mode: state.mode }),
    ...(state.device === "" ? {} : { device: state.device }),
    ...(state.range === "" ? {} : { range: state.range }),
  };
};

/** `query` with the query text replaced: what typing in the search field does to the URL. */
export const withQ = <V extends Query[string]>(
  query: Readonly<Record<string, V>>,
  q: string,
): Record<string, V | string> => withState(query, { ...fromQuery(query), q });
