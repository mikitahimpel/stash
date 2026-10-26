<script setup lang="ts">
import type * as Link from "@stash/contracts-domain/link";
import type * as Tag from "@stash/contracts-domain/tag";
import Badge from "@stash/web-ui/badge";
import { RouterLink } from "vue-router";
import LinkActions from "./link-actions.vue";
import * as LinkDisplay from "./link-display.ts";

defineProps<{ link: Link.Link }>();
const emit = defineEmits<{ tag: [tag: Tag.TagName]; type: [type: Link.LinkType] }>();
</script>

<template>
  <article data-slot="link-card" class="flex flex-col gap-2 rounded-xl border bg-card p-4">
    <div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <a :href="link.url" target="_blank" rel="noopener noreferrer" class="hover:underline">
        {{ LinkDisplay.domain(link) }}
      </a>
      <button
        v-if="link.type !== null"
        type="button"
        data-filter="type"
        @click="emit('type', link.type)"
      >
        <Badge variant="secondary">{{ LinkDisplay.typeLabels[link.type] }}</Badge>
      </button>
      <Badge v-if="link.status === 'new'" variant="outline">New</Badge>
    </div>
    <RouterLink
      :to="{ name: 'link-details', params: { id: link.id } }"
      class="font-medium break-words hover:underline"
    >
      {{ LinkDisplay.title(link) }}
    </RouterLink>
    <p v-if="link.summary" class="line-clamp-3 text-sm text-muted-foreground">
      {{ link.summary }}
    </p>
    <div v-if="link.tags.length > 0" class="flex flex-wrap gap-1">
      <button
        v-for="tag in link.tags"
        :key="tag"
        type="button"
        data-filter="tag"
        @click="emit('tag', tag)"
      >
        <Badge variant="outline">#{{ tag }}</Badge>
      </button>
    </div>
    <LinkActions :link="link" />
  </article>
</template>
