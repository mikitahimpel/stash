<script setup lang="ts">
import { useAtom, useAtomValue } from "@effect/atom-vue";
import type * as SearchGroup from "@stash/contracts-api/search";
import type * as Link from "@stash/contracts-domain/link";
import EmptyState from "@stash/web-ui/empty-state";
import Input from "@stash/web-ui/input";
import Skeleton from "@stash/web-ui/skeleton";
import Tabs from "@stash/web-ui/tabs";
import TabsList from "@stash/web-ui/tabs-list";
import TabsTrigger from "@stash/web-ui/tabs-trigger";
import { SearchX, Search } from "@lucide/vue";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { computed } from "vue";
import * as SearchAtoms from "./search-atoms.ts";
import * as SearchRequest from "./search-request.ts";
import SearchResultCard from "./search-result-card.vue";

const [q, setQ] = useAtom(() => SearchAtoms.q);
const [mode, setMode] = useAtom(() => SearchAtoms.mode);
const [type, setType] = useAtom(() => SearchAtoms.type);
const [tag, setTag] = useAtom(() => SearchAtoms.tag);
const results = useAtomValue(() => SearchAtoms.results);

const qModel = computed({
  get: () => q.value,
  set: (value: string | number | undefined) => setQ(`${value ?? ""}`),
});
const tagModel = computed({
  get: () => tag.value,
  set: (value: string | number | undefined) => setTag(`${value ?? ""}`),
});
const modeModel = computed({
  get: () => mode.value,
  set: (value: string | number) => setMode(value as SearchGroup.SearchMode),
});
const typeModel = computed({
  get: () => type.value,
  set: (value: Link.LinkType | "") => setType(value),
});

const hits = computed(() =>
  results.value !== null && AsyncResult.isSuccess(results.value) ? results.value.value.hits : null,
);
const loading = computed(() => results.value !== null && AsyncResult.isInitial(results.value));
const failed = computed(() => results.value !== null && AsyncResult.isFailure(results.value));
</script>

<template>
  <section class="flex flex-col gap-4">
    <h1 class="text-xl font-semibold">Search</h1>

    <!-- Kit components declare only their props, so strictTemplates rejects plain attributes on
         them. Attributes that fall through to the root element go in a `v-bind` object. -->
    <form class="flex flex-col gap-3" role="search" @submit.prevent>
      <Input
        v-model="qModel"
        v-bind="{
          type: 'search',
          'aria-label': 'Search links',
          placeholder: 'Search by meaning or keywords',
          autofocus: true,
        }"
      />
      <div class="flex flex-wrap items-center gap-2">
        <Tabs v-model="modeModel">
          <TabsList v-bind="{ 'aria-label': 'Search mode' }">
            <TabsTrigger
              v-for="option in SearchRequest.modes"
              :key="option.value"
              :value="option.value"
            >
              {{ option.label }}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <select
          v-model="typeModel"
          aria-label="Type"
          class="h-9 rounded-md border border-input bg-transparent px-2 text-sm dark:bg-input/30"
        >
          <option value="">Any type</option>
          <option v-for="option in SearchRequest.types" :key="option" :value="option">
            {{ option }}
          </option>
        </select>
        <Input
          v-model="tagModel"
          v-bind="{ 'aria-label': 'Tag', placeholder: 'Tag' }"
          class="w-32"
        />
      </div>
    </form>

    <EmptyState
      v-if="results === null"
      title="Find a link"
      description="Type a few words. Hybrid search matches both meaning and keywords."
    >
      <template #icon><Search /></template>
    </EmptyState>

    <div v-else-if="loading" data-testid="search-loading" class="flex flex-col gap-3">
      <Skeleton v-for="i in 3" :key="i" class="h-20 w-full" />
    </div>

    <EmptyState
      v-else-if="failed"
      title="Search failed"
      description="Something went wrong. Try again in a moment."
    />

    <EmptyState
      v-else-if="hits !== null && hits.length === 0"
      title="No matches"
      description="Try other words, another mode or fewer filters."
    >
      <template #icon><SearchX /></template>
    </EmptyState>

    <ul v-else-if="hits !== null" class="flex flex-col gap-3" aria-label="Results">
      <li v-for="hit in hits" :key="hit.link.id">
        <SearchResultCard :link="hit.link" />
      </li>
    </ul>
  </section>
</template>
