<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { cn } from "../cn";

// A label between the rows of one list, for the parts of a group (the windows of a device): a
// 28px muted line with a name and a count, on the content edge like the group's header. It is
// not a heading of its own, so the group's `<GroupHeader>` stays the one that folds and sticks.
const props = withDefaults(
  defineProps<{
    title: string;
    count?: number | string;
    as?: string;
    class?: HTMLAttributes["class"];
  }>(),
  { as: "div" },
);
</script>

<template>
  <component
    :is="as"
    data-slot="compact-row-label"
    :class="
      cn('flex h-7 min-w-0 items-end gap-2 pb-1 text-meta text-muted-foreground', props.class)
    "
  >
    <span class="truncate">{{ title }}</span>
    <span v-if="count !== undefined" class="shrink-0 tabular-nums">{{ count }}</span>
  </component>
</template>
