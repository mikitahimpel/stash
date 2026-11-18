import { injectRegistry, useAtomValue } from "@effect/atom-vue";
import type * as SearchGroup from "@stash/contracts-api/search";
import * as DateTime from "effect/DateTime";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { computed, shallowRef, watch } from "vue";
import * as SearchAtoms from "./search-atoms.ts";
import * as SearchRequest from "./search-request.ts";

/**
 * The results of the search `form` describes, for the list that shows them in place. The hits of
 * the last answer stay (`hits`) while the next query loads (`waiting`), so the list never blanks
 * or jumps between two queries; they go once the query is cleared.
 */
export const useSearchResults = (form: () => SearchRequest.Form) => {
  const registry = injectRegistry();
  const query = computed(() => SearchRequest.fromForm(form(), DateTime.nowUnsafe()));
  const result = useAtomValue(() => SearchAtoms.results(query.value));

  const shown = shallowRef<ReadonlyArray<SearchGroup.SearchHit> | null>(null);
  watch(
    result,
    (now) => {
      if (now === null || AsyncResult.isFailure(now)) shown.value = null;
      else if (AsyncResult.isSuccess(now)) shown.value = now.value.hits;
    },
    { immediate: true },
  );

  const searching = computed(() => query.value !== undefined);
  const failed = computed(() => result.value !== null && AsyncResult.isFailure(result.value));
  /** A request is running: the first one, or the next while the last hits stay on screen. */
  const waiting = computed(
    () => result.value !== null && (AsyncResult.isInitial(result.value) || result.value.waiting),
  );
  /** The terms to mark in the rows: the query, in the modes that match words. */
  const highlight = computed(() => {
    const current = form();
    return searching.value && SearchRequest.matchesWords(current.mode) ? current.q : "";
  });
  const retry = () => {
    if (query.value !== undefined) registry.refresh(SearchAtoms.results(query.value));
  };

  return { searching, hits: shown, waiting, failed, highlight, retry };
};
