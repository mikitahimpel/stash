<script setup lang="ts">
import { injectRegistry, useAtom, useAtomSet, useAtomValue } from "@effect/atom-vue";
import { Clock, X } from "@lucide/vue";
import type * as SearchGroup from "@stash/contracts-api/search";
import type * as Link from "@stash/contracts-domain/link";
import Button from "@stash/web-ui/button";
import EmptyState from "@stash/web-ui/empty-state";
import ErrorState from "@stash/web-ui/error-state";
import FilterMenu from "@stash/web-ui/filter-menu";
import GroupHeader from "@stash/web-ui/group-header";
import Kbd from "@stash/web-ui/kbd";
import ListRow from "@stash/web-ui/list-row";
import ListRowTitle from "@stash/web-ui/list-row-title";
import ScrollRow from "@stash/web-ui/scroll-row";
import SearchField from "@stash/web-ui/search-field";
import SegmentedControl from "@stash/web-ui/segmented-control";
import Skeleton from "@stash/web-ui/skeleton";
import ToggleChip from "@stash/web-ui/toggle-chip";
import { useDelayedLoading } from "@stash/web-ui/use-delayed-loading";
import * as DateTime from "effect/DateTime";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { computed, nextTick, onMounted, ref, watch } from "vue";
import SearchResultRow from "./results/search-result-row.vue";
import * as SearchAtoms from "./search-atoms.ts";
import * as SearchRequest from "./search-request.ts";

// The search field is the page's header. Under it sits one row of filter menus (type, device,
// date) with the mode switch at the end: on a phone that row is a single line that scrolls
// sideways, so the results start right under it. Results are media rows with the query's terms
// marked.
// Before anything is typed the page offers the searches made on this device and the latest links.

// The query of a link to this page (`/search?q=…`, see `routes.ts`): it replaces what was typed.
const props = defineProps<{ query?: string }>();

const registry = injectRegistry();
const [q, setQ] = useAtom(() => SearchAtoms.q);
if (props.query !== undefined) setQ(props.query);
const [mode, setMode] = useAtom(() => SearchAtoms.mode);
const [type, setType] = useAtom(() => SearchAtoms.type);
const [device, setDevice] = useAtom(() => SearchAtoms.device);
const [range, setRange] = useAtom(() => SearchAtoms.range);
const [tag, setTag] = useAtom(() => SearchAtoms.tag);
const form = useAtomValue(() => SearchAtoms.form);
const results = useAtomValue(() => SearchAtoms.results);
const saved = useAtomValue(() => SearchAtoms.saved);
const devices = useAtomValue(() => SearchAtoms.devices);
const recent = useAtomValue(() => SearchAtoms.recent);
const markSeen = useAtomSet(() => SearchAtoms.markSeen);
const remember = useAtomSet(() => SearchAtoms.remember);
const forget = useAtomSet(() => SearchAtoms.forget);

const qModel = computed({ get: () => q.value, set: setQ });
const searching = computed(() => q.value.trim() !== "");
const modeModel = computed({
  get: () => mode.value,
  set: (value: SearchGroup.SearchMode) => setMode(value),
});

const hits = computed(() =>
  results.value !== null && AsyncResult.isSuccess(results.value) ? results.value.value.hits : null,
);
const loading = computed(
  () => searching.value && (results.value === null || AsyncResult.isInitial(results.value)),
);
// The skeleton only shows when a request takes a while (typing alone never shows it); results stay
// cached between visits.
const skeleton = useDelayedLoading(
  () => results.value !== null && AsyncResult.isInitial(results.value),
);
const retry = () => SearchAtoms.retry(registry);
const failed = computed(() => results.value !== null && AsyncResult.isFailure(results.value));
const highlight = computed(() => (SearchRequest.matchesWords(mode.value) ? q.value : ""));

const typeOptions = SearchRequest.types.map((value) => ({
  value,
  label: SearchRequest.typeLabels[value],
}));
const deviceList = computed(() =>
  AsyncResult.isSuccess(devices.value) ? devices.value.value : [],
);
const deviceOptions = computed(() =>
  deviceList.value.map((item) => ({ value: item.id as string, label: item.name })),
);
const deviceNames = computed(
  () => new Map(deviceList.value.map((item) => [item.id as string, item.name])),
);
const deviceName = (link: Link.Link) =>
  link.sourceDeviceId === null ? undefined : deviceNames.value.get(link.sourceDeviceId);

// Ages are counted from when the lists last changed, not from every render.
const now = computed(() => {
  void hits.value;
  void saved.value;
  void recent.value;
  return Date.now();
});

/** How many of the latest links the page shows before anything is typed. */
const recentLinkCount = 5;
const recentLinks = computed(() =>
  (AsyncResult.isSuccess(saved.value) ? saved.value.value.items : [])
    .filter((link) => SearchRequest.passes(form.value, DateTime.makeUnsafe(now.value), link))
    .slice(0, recentLinkCount),
);
const recentSearches = computed(() =>
  AsyncResult.isSuccess(recent.value) ? recent.value.value : [],
);

// The keyboard moves through the results by focusing their links, so ↵ opens one natively and S
// (outside the search field) marks it seen. ↑ on the first result goes back to the field.
const rows = computed(() => (searching.value ? (hits.value ?? []).map((hit) => hit.link) : []));
const selectedId = ref<Link.LinkId | null>(null);
const selectedIndex = computed(() => rows.value.findIndex((link) => link.id === selectedId.value));
watch(rows, () => {
  if (selectedIndex.value === -1) selectedId.value = null;
});

const list = ref<HTMLElement | null>(null);
const field = ref<HTMLElement | null>(null);
const focusField = () => field.value?.querySelector<HTMLElement>("input")?.focus();
onMounted(focusField);
const resultLink = (index: number) =>
  list.value?.querySelectorAll<HTMLElement>("a[data-result-link]")[index];

const select = async (index: number) => {
  const link = rows.value[index];
  if (link === undefined) return;
  selectedId.value = link.id;
  await nextTick();
  resultLink(index)?.focus();
};

const isTextField = (target: EventTarget | null) =>
  target instanceof HTMLElement && target.matches("input, textarea, select, [contenteditable]");

/** A search the user acted on goes to the recent searches. */
const rememberQuery = () => {
  if (searching.value) remember(q.value);
};

const search = (query: string) => {
  setQ(query);
  focusField();
};

const onKeydown = (event: KeyboardEvent) => {
  // The mode control uses the arrow keys itself.
  if (event.defaultPrevented || event.altKey || event.metaKey || event.ctrlKey) return;
  const inField = isTextField(event.target);
  if (event.key === "ArrowDown") {
    event.preventDefault();
    void select(inField ? 0 : selectedIndex.value + 1);
  } else if (event.key === "ArrowUp" && !inField) {
    event.preventDefault();
    if (selectedIndex.value <= 0) {
      selectedId.value = null;
      focusField();
    } else void select(selectedIndex.value - 1);
  } else if (event.key === "Enter" && inField) {
    event.preventDefault();
    rememberQuery();
    if (rows.value.length > 0) resultLink(Math.max(0, selectedIndex.value))?.click();
  } else if (event.key === "Escape" && searching.value) {
    event.preventDefault();
    selectedId.value = null;
    search("");
  } else if (event.key.toLowerCase() === "s" && !inField && selectedId.value !== null) {
    event.preventDefault();
    markSeen(selectedId.value);
  }
};

const onFocusin = (event: FocusEvent) => {
  const row = (event.target as HTMLElement | null)?.closest?.("[data-hit]");
  const id = row?.getAttribute("data-hit");
  if (id) selectedId.value = id as Link.LinkId;
};

// Opening a result (a click, or ↵ on its link) is acting on the search.
const onResultsClick = (event: MouseEvent) => {
  if ((event.target as HTMLElement | null)?.closest?.("a[data-result-link]")) rememberQuery();
};
</script>

<template>
  <section class="flex flex-col gap-6" @keydown="onKeydown" @focusin="onFocusin">
    <h1 class="sr-only">Search</h1>

    <!-- Kit components declare only their props, so strictTemplates rejects plain attributes on
         them. Attributes that fall through to the input go in a `v-bind` object. -->
    <form class="flex flex-col gap-3" role="search" @submit.prevent>
      <div ref="field">
        <SearchField
          v-model="qModel"
          size="lg"
          v-bind="{
            'aria-label': 'Search links',
            placeholder: 'Search titles, summaries and page text',
            autofocus: true,
          }"
        />
      </div>
      <ScrollRow>
        <div class="flex items-center gap-2 sm:flex-wrap" role="group" aria-label="Filters">
          <FilterMenu
            label="Type"
            :options="typeOptions"
            :model-value="type"
            @update:model-value="setType"
          />
          <FilterMenu
            v-if="deviceOptions.length > 0"
            label="Device"
            :options="deviceOptions"
            :model-value="device"
            @update:model-value="setDevice"
          />
          <FilterMenu
            label="Date"
            :options="SearchRequest.ranges"
            :model-value="range"
            @update:model-value="setRange"
          />
          <ToggleChip v-if="tag !== ''" pressed data-clear="tag" @update:pressed="setTag('')">
            #{{ tag }}
            <span class="sr-only">(clear tag filter)</span>
          </ToggleChip>
        </div>
        <SegmentedControl
          v-if="searching"
          v-model="modeModel"
          class="sm:ml-auto"
          :options="SearchRequest.modes"
          label="Search mode"
          size="sm"
        />
      </ScrollRow>
    </form>

    <template v-if="searching">
      <div v-if="loading" class="flex flex-col gap-3" aria-busy="true">
        <div v-if="skeleton" data-testid="search-loading" class="flex flex-col gap-3">
          <Skeleton v-for="i in 3" :key="i" shape="media" />
        </div>
      </div>

      <ErrorState v-else-if="failed" title="Search failed" @retry="retry" />

      <EmptyState
        v-else-if="hits !== null && hits.length === 0"
        title="No matches"
        description="Try other words, or another mode or filter."
      />

      <template v-else-if="hits !== null">
        <section class="flex flex-col gap-2" data-slot="search-results">
          <GroupHeader title="Results" :count="hits.length" />
          <ul ref="list" class="flex flex-col" aria-label="Results" @click="onResultsClick">
            <SearchResultRow
              v-for="hit in hits"
              :key="hit.link.id"
              :link="hit.link"
              :selected="hit.link.id === selectedId"
              :highlight="highlight"
              :device="deviceName(hit.link)"
              :now="now"
              v-bind="{ 'data-hit': hit.link.id }"
              @tag="setTag"
            />
          </ul>
        </section>
        <footer
          class="hidden flex-wrap items-center gap-x-4 gap-y-2 text-meta text-muted-foreground sm:flex"
        >
          <span class="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> move</span>
          <span class="flex items-center gap-1"><Kbd>↵</Kbd> open</span>
          <span class="flex items-center gap-1"><Kbd>S</Kbd> seen</span>
          <span class="flex items-center gap-1"><Kbd>esc</Kbd> clear</span>
        </footer>
      </template>
    </template>

    <div
      v-else-if="recentSearches.length > 0 || recentLinks.length > 0"
      class="flex flex-col gap-8"
    >
      <section
        v-if="recentSearches.length > 0"
        class="flex flex-col gap-2"
        data-slot="recent-searches"
      >
        <GroupHeader title="Recent searches" />
        <ul class="flex flex-col">
          <ListRow v-for="item in recentSearches" :key="item.query" as="li">
            <template #leading><Clock class="w-4" aria-hidden="true" /></template>
            <template #title>
              <ListRowTitle as-child>
                <button
                  type="button"
                  class="text-left"
                  data-action="search-again"
                  @click="search(item.query)"
                >
                  {{ item.query }}
                </button>
              </ListRowTitle>
            </template>
            <template #meta>
              <span>{{ SearchRequest.age(item.at, now) }}</span>
            </template>
            <template #trailing>
              <Button as-child variant="ghost" size="sm">
                <button
                  type="button"
                  data-action="forget"
                  :aria-label="`Remove ${item.query} from recent searches`"
                  title="Remove"
                  @click="forget(item.query)"
                >
                  <X aria-hidden="true" />
                </button>
              </Button>
            </template>
          </ListRow>
        </ul>
      </section>
      <section v-if="recentLinks.length > 0" class="flex flex-col gap-2" data-slot="recent-links">
        <GroupHeader title="Recently saved" />
        <ul class="flex flex-col">
          <SearchResultRow
            v-for="link in recentLinks"
            :key="link.id"
            :link="link"
            :selected="false"
            highlight=""
            :device="deviceName(link)"
            :now="now"
            @tag="setTag"
          />
        </ul>
      </section>
    </div>
  </section>
</template>
