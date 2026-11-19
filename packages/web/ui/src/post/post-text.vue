<script setup lang="ts">
import { computed } from "vue";
import * as PostText from "./post-text";

// The words of a post, with its line breaks, and its links, mentions and hashtags as links that
// open in a new tab. `prose` is reading text (16), `body` the size of a quoted post (14).
const props = withDefaults(
  defineProps<{
    text: string;
    entities?: ReadonlyArray<PostText.TextEntity>;
    size?: "prose" | "body";
  }>(),
  { entities: () => [], size: "prose" },
);

const parts = computed(() => PostText.parts(props.text, props.entities));
</script>

<template>
  <p
    data-slot="post-text"
    :class="[
      'min-w-0 [overflow-wrap:anywhere] whitespace-pre-wrap text-foreground',
      size === 'prose' ? 'text-prose' : 'text-body',
    ]"
  >
    <template v-for="(part, i) in parts" :key="i">
      <a
        v-if="part.url !== undefined"
        :href="part.url"
        target="_blank"
        rel="noopener noreferrer"
        data-slot="post-entity"
        class="rounded-sm text-signal outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/40"
        >{{ part.text }}</a
      >
      <template v-else>{{ part.text }}</template>
    </template>
  </p>
</template>
