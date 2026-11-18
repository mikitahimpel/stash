<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { cn } from "../cn";

// The header of a group of rows (a day in the Inbox): 13/600 uppercase with a
// muted count and a hairline rule to the content edge (or to its `actions`, `ghost` `sm` buttons that
// end on the edge). It sits between the page title and the row titles: stronger than a row, quieter
// than the page.
const props = withDefaults(
  defineProps<{
    title: string;
    count?: number | string;
    as?: "h2" | "h3" | "h4";
    class?: HTMLAttributes["class"];
  }>(),
  { as: "h2" },
);

defineSlots<{ actions?: () => unknown }>();
</script>

<template>
  <div
    data-slot="group-header"
    :class="cn('flex flex-wrap items-center gap-x-3 gap-y-2', props.class)"
  >
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
    <span aria-hidden="true" class="h-px min-w-4 flex-1 bg-hairline" />
    <div
      v-if="$slots.actions"
      data-slot="group-header-actions"
      class="ml-auto flex shrink-0 items-center gap-2"
    >
      <slot name="actions" />
    </div>
  </div>
</template>
