<script setup lang="ts">
import { injectRegistry, useAtom, useAtomSet, useAtomValue } from "@effect/atom-vue";
import type * as SearchGroup from "@stash/contracts-api/search";
import type * as Link from "@stash/contracts-domain/link";
import EmptyState from "@stash/web-ui/empty-state";
import ErrorState from "@stash/web-ui/error-state";
import Kbd from "@stash/web-ui/kbd";
import SearchField from "@stash/web-ui/search-field";
import SectionHeader from "@stash/web-ui/section-header";
import SegmentedControl from "@stash/web-ui/segmented-control";
import Skeleton from "@stash/web-ui/skeleton";
import ToggleChip from "@stash/web-ui/toggle-chip";
import { useDelayedLoading } from "@stash/web-ui/use-delayed-loading";
import * as DateTime from "effect/DateTime";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { computed, nextTick, ref, watch } from "vue";
import SearchResultRow from "./results/search-result-row.vue";
import * as SearchAtoms from "./search-atoms.ts";
import * as SearchRequest from "./search-request.ts";
import MatchTimeline from "./timeline/match-timeline.vue";

const registry = injectRegistry();
const [q, setQ] = useAtom(() => SearchAtoms.q);
const [mode, setMode] = useAtom(() => SearchAtoms.mode);
const [type, setType] = useAtom(() => SearchAtoms.type);
const [tag, setTag] = useAtom(() => SearchAtoms.tag);
const results = useAtomValue(() => SearchAtoms.results);
const saved = useAtomValue(() => SearchAtoms.saved);
const markSeen = useAtomSet(() => SearchAtoms.markSeen);

const qModel = computed({ get: () => q.value, set: setQ });
const modeModel = computed({
  get: () => mode.value,
  set: (value: SearchGroup.SearchMode) => setMode(value),
});

const hits = computed(() =>
  results.value !== null && AsyncResult.isSuccess(results.value) ? results.value.value.hits : null,
);
const loading = computed(() => results.value !== null && AsyncResult.isInitial(results.value));
// The skeleton only shows when a search takes a while; results stay cached between visits.
const skeleton = useDelayedLoading(loading);
const retry = () => SearchAtoms.retry(registry);
const countProp = computed(() =>
  hits.value === null
    ? {}
    : { count: `${hits.value.length} ${hits.value.length === 1 ? "result" : "results"}` },
);
const failed = computed(() => results.value !== null && AsyncResult.isFailure(results.value));

// The background of the timeline and the tag chips. Without it both still work, just emptier.
const savedLinks = computed(() =>
  AsyncResult.isSuccess(saved.value) ? saved.value.value.items : [],
);
const tags = computed(() => SearchRequest.topTags(savedLinks.value, tag.value));
const highlight = computed(() => (SearchRequest.matchesWords(mode.value) ? q.value : ""));

const toPoint = (link: Link.Link) => ({
  id: link.id,
  createdAt: DateTime.toEpochMillis(link.createdAt),
});
const now = Date.now();
const matchPoints = computed(() => (hits.value ?? []).map((hit) => toPoint(hit.link)));
const savedPoints = computed(() => savedLinks.value.map(toPoint));

// The keyboard moves through the results by focusing their links, so ↵ opens one natively and S
// (outside the search field) marks it seen. ↑ on the first result goes back to the field.
const selectedId = ref<Link.LinkId | null>(null);
const selectedIndex = computed(() =>
  (hits.value ?? []).findIndex((hit) => hit.link.id === selectedId.value),
);
watch(hits, () => {
  if (selectedIndex.value === -1) selectedId.value = null;
});

const list = ref<HTMLElement | null>(null);
const field = ref<HTMLElement | null>(null);
const resultLink = (index: number) =>
  list.value?.querySelectorAll<HTMLElement>("a[data-result-link]")[index];

const select = async (index: number) => {
  const hit = hits.value?.[index];
  if (hit === undefined) return;
  selectedId.value = hit.link.id;
  await nextTick();
  resultLink(index)?.focus();
};

const isTextField = (target: EventTarget | null) =>
  target instanceof HTMLElement && target.matches("input, textarea, select, [contenteditable]");

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
      field.value?.querySelector<HTMLElement>("input")?.focus();
    } else void select(selectedIndex.value - 1);
  } else if (event.key === "Enter" && inField && hits.value?.length) {
    event.preventDefault();
    resultLink(Math.max(0, selectedIndex.value))?.click();
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
</script>

<template>
  <section class="flex flex-col gap-5" @keydown="onKeydown" @focusin="onFocusin">
    <SectionHeader as="h1" title="Search" v-bind="countProp" />

    <!-- Kit components declare only their props, so strictTemplates rejects plain attributes on
         them. Attributes that fall through to the input go in a `v-bind` object. -->
    <form class="flex flex-col gap-3" role="search" @submit.prevent>
      <div ref="field">
        <SearchField
          v-model="qModel"
          class="h-12 sm:h-12"
          v-bind="{ 'aria-label': 'Search links', autofocus: true }"
        />
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <SegmentedControl v-model="modeModel" :options="SearchRequest.modes" label="Search mode" />
        <div class="flex flex-wrap gap-2" role="group" aria-label="Type">
          <ToggleChip
            v-for="option in SearchRequest.types"
            :key="option"
            :pressed="type === option"
            @update:pressed="(on: boolean) => setType(on ? option : '')"
          >
            {{ SearchRequest.typeLabels[option] }}
          </ToggleChip>
        </div>
        <div v-if="tags.length > 0" class="flex flex-wrap gap-2" role="group" aria-label="Tag">
          <ToggleChip
            v-for="name in tags"
            :key="name"
            class="font-mono text-xs"
            :pressed="tag === name"
            @update:pressed="(on: boolean) => setTag(on ? name : '')"
          >
            #{{ name }}
          </ToggleChip>
        </div>
      </div>
    </form>

    <MatchTimeline
      :now="now"
      :matches="matchPoints"
      :saved="savedPoints"
      :selected="selectedId ?? undefined"
    />

    <EmptyState v-if="results === null" title="Find a link" />

    <div v-else-if="loading" class="flex flex-col gap-3" aria-busy="true">
      <div v-if="skeleton" data-testid="search-loading" class="flex flex-col gap-3">
        <Skeleton v-for="i in 3" :key="i" class="h-16 w-full" />
      </div>
    </div>

    <ErrorState v-else-if="failed" title="Search failed" @retry="retry" />

    <EmptyState v-else-if="hits !== null && hits.length === 0" title="No matches" />

    <ul v-else-if="hits !== null" ref="list" class="flex flex-col" aria-label="Results">
      <SearchResultRow
        v-for="(hit, index) in hits"
        :key="hit.link.id"
        :link="hit.link"
        :rank="index + 1"
        :selected="hit.link.id === selectedId"
        :highlight="highlight"
        v-bind="{ 'data-hit': hit.link.id }"
      />
    </ul>

    <footer
      class="hidden flex-wrap items-center gap-x-4 gap-y-2 font-mono text-xs text-muted-foreground sm:flex"
    >
      <span class="flex items-center gap-1.5"><Kbd>↑</Kbd><Kbd>↓</Kbd> move</span>
      <span class="flex items-center gap-1.5"><Kbd>↵</Kbd> open</span>
      <span class="flex items-center gap-1.5"><Kbd>S</Kbd> seen</span>
    </footer>
  </section>
</template>
