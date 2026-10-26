<script setup lang="ts">
import * as AtomVue from "@effect/atom-vue";
import { ArrowLeft, ExternalLink } from "@lucide/vue";
import type * as Link from "@stash/contracts-domain/link";
import Badge from "@stash/web-ui/badge";
import Button from "@stash/web-ui/button";
import EmptyState from "@stash/web-ui/empty-state";
import Skeleton from "@stash/web-ui/skeleton";
import * as DateTime from "effect/DateTime";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { computed } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import LinkActions from "../link-actions.vue";
import * as LinkDisplay from "../link-display.ts";
import * as LinksAtoms from "../links-atoms.ts";

const route = useRoute();
const router = useRouter();

// `/links/:id` only matches a non-empty id.
const result = AtomVue.useAtomValue(() =>
  LinksAtoms.details(String(route.params.id) as Link.LinkId),
);

const view = computed(() =>
  AsyncResult.match(result.value, {
    onInitial: () => ({ state: "loading" as const }),
    onFailure: () => ({ state: "missing" as const }),
    onSuccess: ({ value }) => ({ state: "link" as const, link: value }),
  }),
);

const formatDate = (date: DateTime.Utc) =>
  DateTime.formatUtc(date, { dateStyle: "medium", timeStyle: "short", locale: "en" });
</script>

<template>
  <section class="flex flex-col gap-4">
    <Button variant="ghost" size="sm" class="self-start" as-child>
      <RouterLink :to="{ name: 'links' }"><ArrowLeft aria-hidden="true" /> Links</RouterLink>
    </Button>

    <div v-if="view.state === 'loading'" class="flex flex-col gap-3" aria-busy="true">
      <Skeleton class="h-8 w-2/3" />
      <Skeleton class="h-24" />
    </div>
    <EmptyState
      v-else-if="view.state === 'missing'"
      title="Link not found"
      description="It may have been deleted."
    />
    <article v-else class="flex flex-col gap-4">
      <header class="flex flex-col gap-2">
        <h1 class="text-xl font-semibold break-words">{{ LinkDisplay.title(view.link) }}</h1>
        <a
          :href="view.link.url"
          target="_blank"
          rel="noopener noreferrer"
          class="flex items-center gap-1 text-sm text-muted-foreground hover:underline"
        >
          {{ LinkDisplay.domain(view.link) }}
          <ExternalLink class="size-3" aria-hidden="true" />
        </a>
        <div class="flex flex-wrap gap-1">
          <Badge variant="outline">{{ LinkDisplay.statusLabels[view.link.status] }}</Badge>
          <Badge v-if="view.link.type !== null" variant="secondary">
            {{ LinkDisplay.typeLabels[view.link.type] }}
          </Badge>
          <RouterLink
            v-for="tag in view.link.tags"
            :key="tag"
            :to="{
              name: 'links',
              query: LinksAtoms.toQuery({ ...LinksAtoms.defaultFilters, tag }),
            }"
          >
            <Badge variant="outline">#{{ tag }}</Badge>
          </RouterLink>
        </div>
      </header>
      <p v-if="view.link.summary" class="text-sm leading-relaxed">{{ view.link.summary }}</p>
      <p v-else class="text-sm text-muted-foreground">No summary yet.</p>
      <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt class="text-muted-foreground">Saved</dt>
        <dd>{{ formatDate(view.link.createdAt) }}</dd>
        <template v-if="view.link.language !== null">
          <dt class="text-muted-foreground">Language</dt>
          <dd>{{ view.link.language }}</dd>
        </template>
        <template
          v-if="view.link.canonicalUrl !== null && view.link.canonicalUrl !== view.link.url"
        >
          <dt class="text-muted-foreground">Canonical URL</dt>
          <dd class="break-all">{{ view.link.canonicalUrl }}</dd>
        </template>
      </dl>
      <LinkActions :link="view.link" :after-remove="() => router.replace({ name: 'links' })" />
    </article>
  </section>
</template>
