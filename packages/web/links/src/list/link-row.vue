<script setup lang="ts">
import type * as Link from "@stash/contracts-domain/link";
import ListRow from "@stash/web-ui/list-row";
import ListRowTitle from "@stash/web-ui/list-row-title";
import type * as DateTime from "effect/DateTime";
import { RouterLink } from "vue-router";
import LinkActions from "../link-actions.vue";
import * as LinkDisplay from "../link-display.ts";
import * as LinksAtoms from "../links-atoms.ts";

const props = defineProps<{
  link: Link.Link;
  selected: boolean;
  /** The name of the device the link was saved from, if known. */
  device: string | undefined;
  now: DateTime.Utc;
  /** The feed's filters: a tag or type on the row narrows them. */
  filters: LinksAtoms.Filters;
}>();
const emit = defineEmits<{ select: [] }>();

const narrow = (patch: Partial<LinksAtoms.Filters>) => ({
  name: "links",
  query: LinksAtoms.toQuery({ ...props.filters, ...patch }),
});
</script>

<template>
  <ListRow
    as="li"
    :selected="selected"
    data-slot="link-row"
    v-bind="{ 'aria-current': selected ? true : undefined, onClick: () => emit('select') }"
  >
    <template #title>
      <ListRowTitle as-child>
        <RouterLink :to="{ name: 'link-details', params: { id: link.id } }">
          {{ LinkDisplay.title(link) }}
        </RouterLink>
      </ListRowTitle>
    </template>
    <template #meta>
      <a :href="link.url" target="_blank" rel="noopener noreferrer" class="hover:text-foreground">{{
        LinkDisplay.domain(link)
      }}</a>
      <span v-if="device !== undefined" data-slot="link-device">{{ device }}</span>
      <span>{{ LinkDisplay.age(link.createdAt, now) }}</span>
    </template>
    <p v-if="link.enrichedAt === null" class="text-meta text-muted-foreground">summarizing…</p>
    <p v-else-if="link.summary" class="truncate text-body text-muted-foreground">
      {{ link.summary }}
    </p>
    <div
      v-if="link.type !== null || link.tags.length > 0"
      class="flex flex-wrap gap-x-3 text-meta text-muted-foreground"
    >
      <RouterLink
        v-if="link.type !== null"
        :to="narrow({ type: link.type })"
        replace
        data-filter="type"
        class="hover:text-foreground"
        @click.stop
      >
        {{ link.type }}
      </RouterLink>
      <RouterLink
        v-for="tag in link.tags"
        :key="tag"
        :to="narrow({ tag })"
        replace
        data-filter="tag"
        class="hover:text-foreground"
        @click.stop
      >
        #{{ tag }}
      </RouterLink>
    </div>
    <template #actions>
      <LinkActions :link="link" shortcuts />
    </template>
  </ListRow>
</template>
