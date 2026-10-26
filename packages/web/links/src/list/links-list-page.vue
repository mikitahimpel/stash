<script setup lang="ts">
import * as AtomVue from "@effect/atom-vue";
import { Inbox } from "@lucide/vue";
import EmptyState from "@stash/web-ui/empty-state";
import Skeleton from "@stash/web-ui/skeleton";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import LinkCard from "../link-card.vue";
import * as LinksAtoms from "../links-atoms.ts";
import LinksFilters from "./links-filters.vue";
import LoadMore from "./load-more.vue";

const route = useRoute();
const router = useRouter();

const filters = computed(() => LinksAtoms.fromQuery(route.query));
const setFilters = (next: LinksAtoms.Filters) =>
  router.replace({ query: LinksAtoms.toQuery(next) });

const [result, pull] = AtomVue.useAtom(() => LinksAtoms.feed(filters.value));

const view = computed(() =>
  AsyncResult.match(result.value, {
    onInitial: () => ({ state: "loading" as const }),
    onFailure: (failure) =>
      // An empty feed fails with NoSuchElementError.
      failure.cause.reasons.some(
        (reason) => reason._tag === "Fail" && reason.error._tag === "NoSuchElementError",
      )
        ? { state: "empty" as const }
        : { state: "error" as const },
    onSuccess: ({ value, waiting }) => ({
      state: "links" as const,
      links: value.items,
      done: value.done,
      waiting,
    }),
  }),
);

const emptyText = computed(() =>
  filters.value.tag !== undefined || filters.value.type !== undefined
    ? "No links match these filters."
    : filters.value.feed === "unseen"
      ? "You've seen everything you saved."
      : "Links you save show up here.",
);
</script>

<template>
  <section class="flex flex-col gap-4">
    <h1 class="text-xl font-semibold">Links</h1>
    <LinksFilters :filters="filters" @change="setFilters" />

    <div v-if="view.state === 'loading'" class="flex flex-col gap-3" aria-busy="true">
      <Skeleton v-for="n in 3" :key="n" class="h-28" />
    </div>
    <EmptyState v-else-if="view.state === 'empty'" title="Nothing here" :description="emptyText">
      <template #icon><Inbox /></template>
    </EmptyState>
    <p v-else-if="view.state === 'error'" role="alert" class="text-sm text-destructive">
      Couldn't load links. Reload the page to try again.
    </p>
    <template v-else>
      <ul class="flex flex-col gap-3">
        <li v-for="link in view.links" :key="link.id">
          <LinkCard
            :link="link"
            @tag="(tag) => setFilters({ ...filters, tag })"
            @type="(type) => setFilters({ ...filters, type })"
          />
        </li>
      </ul>
      <LoadMore v-if="!view.done" :loading="view.waiting" @more="pull()" />
    </template>
  </section>
</template>
