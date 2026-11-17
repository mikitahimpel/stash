<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { cn } from "../cn";

// The header of a group of rows (a day in the Inbox), proposed in #148: 13/600 uppercase with a
// muted count and a hairline rule to the content edge. It sits between the page title and the row
// titles: stronger than a row, quieter than the page.
const props = withDefaults(
  defineProps<{
    title: string;
    count?: number | string;
    as?: "h2" | "h3" | "h4";
    class?: HTMLAttributes["class"];
  }>(),
  { as: "h2" },
);
</script>

<template>
  <div data-slot="group-header" :class="cn('flex items-center gap-3', props.class)">
    <component
      :is="as"
      class="flex shrink-0 items-baseline gap-2 text-meta font-semibold tracking-[0.06em] text-foreground uppercase"
    >
      {{ title }}
      <span
        v-if="count !== undefined"
        data-slot="group-header-count"
        class="font-normal tracking-normal text-muted-foreground tabular-nums"
        >{{ count }}</span
      >
    </component>
    <span aria-hidden="true" class="h-px flex-1 bg-hairline" />
  </div>
</template>
