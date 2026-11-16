<script setup lang="ts">
import { ChevronRight } from "@lucide/vue";
import type { HTMLAttributes } from "vue";
import { cn } from "../cn";

const props = defineProps<{
  /** The line that opens it, for example `Advanced`. */
  summary: string;
  class?: HTMLAttributes["class"];
}>();
</script>

<template>
  <!-- A native <details>: a quiet 32px summary line with a chevron, its contents 8px below. -->
  <details data-slot="disclosure" :class="cn('group flex flex-col', props.class)">
    <summary
      data-slot="disclosure-summary"
      class="relative hit-area flex h-control-sm w-fit cursor-pointer list-none items-center gap-1 rounded-control text-meta text-muted-foreground outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring/40 [&::-webkit-details-marker]:hidden"
    >
      <ChevronRight
        aria-hidden="true"
        class="size-4 transition-transform group-open:rotate-90 motion-reduce:transition-none"
      />
      {{ summary }}
    </summary>
    <div data-slot="disclosure-content" class="flex flex-col gap-4 pt-2">
      <slot />
    </div>
  </details>
</template>
