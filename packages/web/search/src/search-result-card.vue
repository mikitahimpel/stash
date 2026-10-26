<script setup lang="ts">
import type * as Link from "@stash/contracts-domain/link";
import Badge from "@stash/web-ui/badge";
import Card from "@stash/web-ui/card";
import { computed } from "vue";

// A small card of its own: the search page doesn't depend on `@stash/web-links`.
const props = defineProps<{ link: Link.Link }>();

const host = computed(() => new URL(props.link.url).host);
</script>

<template>
  <Card class="gap-2 px-4 py-4">
    <a
      :href="link.url"
      target="_blank"
      rel="noopener noreferrer"
      class="font-medium break-words hover:underline"
    >
      {{ link.title ?? link.url }}
    </a>
    <p class="truncate text-xs text-muted-foreground">{{ host }}</p>
    <p v-if="link.summary" class="line-clamp-3 text-sm text-muted-foreground">
      {{ link.summary }}
    </p>
    <div v-if="link.type || link.tags.length > 0" class="flex flex-wrap gap-1">
      <Badge v-if="link.type" variant="secondary">{{ link.type }}</Badge>
      <Badge v-for="tagName in link.tags" :key="tagName" variant="outline">#{{ tagName }}</Badge>
    </div>
  </Card>
</template>
