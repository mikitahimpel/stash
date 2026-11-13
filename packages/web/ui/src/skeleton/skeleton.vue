<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { cn } from "../cn";

/**
 * The placeholders a page needs, sized by the kit: `line` (a line of text), `title`, `row` (a
 * 52px list row), `control` (a 36px field or button), `chip` (a 32px chip) and `chart`. Callers
 * set only the width.
 */
const props = withDefaults(
  defineProps<{
    shape?: "line" | "title" | "row" | "control" | "chip" | "chart";
    class?: HTMLAttributes["class"];
  }>(),
  { shape: "line" },
);

const shapes = {
  line: "h-4 rounded-sm",
  title: "h-6 rounded-sm",
  row: "h-13 rounded-control",
  control: "h-control-md rounded-control",
  chip: "h-control-sm w-20 rounded-control",
  chart: "h-28 rounded-control",
} as const;
</script>

<template>
  <div
    data-slot="skeleton"
    aria-hidden="true"
    :class="cn('animate-pulse bg-hairline', shapes[shape], props.class)"
  />
</template>
