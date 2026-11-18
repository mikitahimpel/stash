<script setup lang="ts">
import { useAtomSet, useAtomValue } from "@effect/atom-vue";
import { Clock, X } from "@lucide/vue";
import Button from "@stash/web-ui/button";
import FieldPopup from "@stash/web-ui/field-popup";
import FieldPopupItem from "@stash/web-ui/field-popup-item";
import SearchField from "@stash/web-ui/search-field";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import * as SearchAtoms from "./search-atoms.ts";
import * as SearchRoute from "./search-route.ts";

// The one search field of the app, for the app header. What is typed goes to the URL of the Inbox
// (`/links?q=…`) once typing pauses, and the Inbox shows the results in place; from any other page
// the first query opens the Inbox. Clearing the field gives the Inbox its feed back. While the
// field is focused and empty, the searches made on this device hang under it.

const route = useRoute();
const router = useRouter();

/** The name of the route that shows the results. */
const resultsRoute = "links";
const onResults = computed(() => route.name === resultsRoute);
const urlQ = computed(() => (onResults.value ? SearchRoute.fromQuery(route.query).q : ""));

const text = ref(urlQ.value);
let timer: ReturnType<typeof setTimeout> | undefined;
// Navigations of our own that are still running. The URL follows the field then, not the reverse.
let writing = 0;
const stopTimer = () => {
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
};
onBeforeUnmount(stopTimer);

// Back, forward, a link with a query or leaving the Inbox: the field shows what the URL says.
// `sync`, so it sees our own navigations while they still count as running.
watch(
  urlQ,
  (q) => {
    if (writing === 0 && timer === undefined && q !== text.value) text.value = q;
  },
  { flush: "sync" },
);

/** Puts the query in the URL now. A blank one clears the search. */
const write = (q: string) => {
  stopTimer();
  const blank = q.trim() === "";
  // Nothing to clear on a page without results, and nothing to change when the URL has it.
  if (blank ? urlQ.value === "" : onResults.value && urlQ.value === q) return;
  const location = {
    name: resultsRoute,
    query: SearchRoute.withQ(onResults.value ? route.query : {}, blank ? "" : q),
  };
  // A search is one history entry: starting it adds the entry, refining or clearing replaces it.
  writing++;
  void (urlQ.value === "" ? router.push(location) : router.replace(location)).finally(
    () => writing--,
  );
};

const flush = () => {
  if (timer !== undefined) write(text.value);
};

const onInput = (value: string) => {
  text.value = value;
  stopTimer();
  timer = setTimeout(() => write(text.value), SearchAtoms.debounceMillis);
};

const recent = useAtomValue(() => SearchAtoms.recent);
const remember = useAtomSet(() => SearchAtoms.remember);
const forget = useAtomSet(() => SearchAtoms.forget);

/** How many recent searches hang under the field. */
const maxSuggestions = 6;
const suggestions = computed(() =>
  (AsyncResult.isSuccess(recent.value) ? recent.value.value : []).slice(0, maxSuggestions),
);
const focused = ref(false);
const open = computed(() => focused.value && text.value === "" && suggestions.value.length > 0);
/** The suggestion the arrow keys are on, or -1 for the field itself. */
const active = ref(-1);
watch(open, () => (active.value = -1));

const pick = (query: string) => {
  text.value = query;
  remember(query);
  write(query);
};

const blur = (event: Event) => (event.target as HTMLElement | null)?.blur?.();

const onKeydown = (event: KeyboardEvent) => {
  if (event.isComposing || event.altKey || event.metaKey || event.ctrlKey) return;
  if (event.key === "Escape") {
    // Clears and leaves the field. The key stays here, so nothing behind the field hears it.
    event.preventDefault();
    text.value = "";
    write("");
    blur(event);
  } else if (event.key === "Enter") {
    event.preventDefault();
    const suggestion = open.value ? suggestions.value[active.value] : undefined;
    if (suggestion !== undefined) return pick(suggestion.query);
    flush();
    if (text.value.trim() !== "") remember(text.value);
    // The results take the keys from here: ↑/↓ select a row, ↵ opens it.
    blur(event);
  } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    if (open.value) {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      active.value = Math.max(-1, Math.min(suggestions.value.length - 1, active.value + step));
    } else if (event.key === "ArrowDown" && text.value.trim() !== "") {
      event.preventDefault();
      flush();
      blur(event);
    }
  }
};

const onFocus = () => (focused.value = true);
const onBlur = () => {
  focused.value = false;
  flush();
};
</script>

<template>
  <form role="search" data-slot="search-box" @submit.prevent>
    <FieldPopup :open="open" label="Recent searches">
      <!-- Kit components declare only their props, so strictTemplates rejects plain attributes
           on them. Attributes that fall through to the input go in a `v-bind` object. -->
      <SearchField
        :model-value="text"
        shortcut="⌘K"
        size="sm"
        v-bind="{
          'aria-label': 'Search links',
          'aria-keyshortcuts': 'Meta+K Control+K /',
          placeholder: 'Search links',
          autocomplete: 'off',
          enterkeyhint: 'search',
          onKeydown,
          onFocus,
          onBlur,
        }"
        @update:model-value="onInput"
      />
      <template #panel>
        <FieldPopupItem
          v-for="(item, index) in suggestions"
          :key="item.query"
          :active="index === active"
          v-bind="{ 'data-recent': item.query }"
          @pick="pick(item.query)"
        >
          <template #icon><Clock aria-hidden="true" /></template>
          {{ item.query }}
          <template #trailing>
            <Button as-child variant="ghost" size="sm">
              <button
                type="button"
                tabindex="-1"
                data-action="forget"
                :aria-label="`Remove ${item.query} from recent searches`"
                title="Remove"
                @click="forget(item.query)"
              >
                <X aria-hidden="true" />
              </button>
            </Button>
          </template>
        </FieldPopupItem>
      </template>
    </FieldPopup>
  </form>
</template>
