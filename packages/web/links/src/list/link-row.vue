<script setup lang="ts">
import type * as Link from "@stash/contracts-domain/link";
import type * as Tag from "@stash/contracts-domain/tag";
import ListRow from "@stash/web-ui/list-row";
import TextLink from "@stash/web-ui/text-link";
import type * as DateTime from "effect/DateTime";
import { RouterLink } from "vue-router";
import LinkActions from "../link-actions.vue";
import * as LinkDisplay from "../link-display.ts";

defineProps<{
  link: Link.Link;
  selected: boolean;
  /** The name of the device the link was saved from, if known. */
  device: string | undefined;
  now: DateTime.Utc;
}>();
const emit = defineEmits<{
  select: [];
  tag: [tag: Tag.TagName];
  type: [type: Link.LinkType];
}>();

const meta = "font-mono text-xs text-muted-foreground";
</script>

<template>
  <ListRow
    as="li"
    :selected="selected"
    data-slot="link-row"
    v-bind="{ 'aria-current': selected ? true : undefined, onClick: () => emit('select') }"
  >
    <div class="flex flex-col gap-x-4 gap-y-1 sm:flex-row sm:items-baseline">
      <TextLink as-child class="min-w-0 text-[15px] break-words sm:flex-1">
        <RouterLink :to="{ name: 'link-details', params: { id: link.id } }">
          {{ LinkDisplay.title(link) }}
        </RouterLink>
      </TextLink>
      <div :class="meta" class="flex shrink-0 flex-wrap gap-x-3">
        <a
          :href="link.url"
          target="_blank"
          rel="noopener noreferrer"
          class="hover:text-foreground"
          >{{ LinkDisplay.domain(link) }}</a
        >
        <span v-if="device !== undefined" data-slot="link-device">{{ device }}</span>
        <span>{{ LinkDisplay.age(link.createdAt, now) }}</span>
      </div>
    </div>
    <p v-if="link.enrichedAt === null" :class="meta">summarizing…</p>
    <p v-else-if="link.summary" class="truncate text-sm text-muted-foreground">
      {{ link.summary }}
    </p>
    <div
      v-if="link.type !== null || link.tags.length > 0"
      :class="meta"
      class="flex flex-wrap gap-x-3"
    >
      <button
        v-if="link.type !== null"
        type="button"
        data-filter="type"
        class="hover:text-foreground"
        @click.stop="emit('type', link.type)"
      >
        {{ link.type }}
      </button>
      <button
        v-for="tag in link.tags"
        :key="tag"
        type="button"
        data-filter="tag"
        class="hover:text-foreground"
        @click.stop="emit('tag', tag)"
      >
        #{{ tag }}
      </button>
    </div>
    <template #actions>
      <LinkActions :link="link" shortcuts />
    </template>
  </ListRow>
</template>
