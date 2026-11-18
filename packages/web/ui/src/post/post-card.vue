<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { cn } from "../cn";

// A post as its own network shows it: one surface with the author on top (`<PostByline>`), the
// words (`<PostText>`), the media (`<PostMedia>`) and, last, a quiet line of facts. A post quoted
// by another is the same card `nested` inside it: tighter, and a level quieter.
const props = withDefaults(defineProps<{ nested?: boolean; class?: HTMLAttributes["class"] }>(), {
  nested: false,
});
</script>

<template>
  <div
    data-slot="post-card"
    :data-nested="nested ? '' : undefined"
    :class="
      cn(
        'flex min-w-0 flex-col rounded-surface border border-hairline',
        nested ? 'gap-2 p-3' : 'gap-3 bg-card p-4 sm:p-5',
        props.class,
      )
    "
  >
    <slot />
  </div>
</template>
