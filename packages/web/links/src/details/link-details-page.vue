<script setup lang="ts">
import * as AtomVue from "@effect/atom-vue";
import { ArrowLeft, ExternalLink } from "@lucide/vue";
import type * as Link from "@stash/contracts-domain/link";
import Button from "@stash/web-ui/button";
import EmptyState from "@stash/web-ui/empty-state";
import Skeleton from "@stash/web-ui/skeleton";
import TextLink from "@stash/web-ui/text-link";
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
  DateTime.format(DateTime.setZone(date, DateTime.zoneMakeLocal()), {
    dateStyle: "medium",
    timeStyle: "short",
    locale: "en",
  });
</script>

<template>
  <section class="flex flex-col gap-5">
    <Button variant="ghost" size="sm" class="self-start" as-child>
      <RouterLink :to="{ name: 'links' }"><ArrowLeft aria-hidden="true" /> Inbox</RouterLink>
    </Button>

    <div v-if="view.state === 'loading'" class="flex flex-col gap-3" aria-busy="true">
      <Skeleton class="h-6 w-2/3" />
      <Skeleton class="h-16" />
    </div>
    <EmptyState
      v-else-if="view.state === 'missing'"
      title="Link not found"
      description="It may have been deleted."
    />
    <article v-else class="flex flex-col gap-4">
      <header class="flex flex-col gap-2 border-b border-hairline pb-4">
        <h1 class="text-[15px] font-medium break-words">{{ LinkDisplay.title(view.link) }}</h1>
        <div class="flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs text-muted-foreground">
          <TextLink as-child class="inline-flex items-center gap-1 text-muted-foreground">
            <a :href="view.link.url" target="_blank" rel="noopener noreferrer">
              {{ LinkDisplay.domain(view.link) }}
              <ExternalLink class="size-3" aria-hidden="true" />
            </a>
          </TextLink>
          <span>{{ view.link.status }}</span>
          <span v-if="view.link.type !== null">{{ view.link.type }}</span>
          <RouterLink
            v-for="tag in view.link.tags"
            :key="tag"
            class="hover:text-foreground"
            :to="{
              name: 'links',
              query: LinksAtoms.toQuery({ ...LinksAtoms.defaultFilters, tag }),
            }"
            >#{{ tag }}</RouterLink
          >
        </div>
      </header>
      <p v-if="view.link.summary" class="max-w-prose text-sm leading-relaxed">
        {{ view.link.summary }}
      </p>
      <p v-else-if="view.link.enrichedAt === null" class="font-mono text-xs text-muted-foreground">
        summarizing…
      </p>
      <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
        <dt class="text-muted-foreground">Saved</dt>
        <dd class="font-mono text-xs leading-5">{{ formatDate(view.link.createdAt) }}</dd>
        <template v-if="view.link.language !== null">
          <dt class="text-muted-foreground">Language</dt>
          <dd class="font-mono text-xs leading-5">{{ view.link.language }}</dd>
        </template>
        <template
          v-if="view.link.canonicalUrl !== null && view.link.canonicalUrl !== view.link.url"
        >
          <dt class="text-muted-foreground">Canonical URL</dt>
          <dd class="font-mono text-xs leading-5 break-all">{{ view.link.canonicalUrl }}</dd>
        </template>
      </dl>
      <LinkActions :link="view.link" :after-remove="() => router.replace({ name: 'links' })" />
    </article>
  </section>
</template>
