<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { cn } from "../cn";

const props = withDefaults(
  defineProps<{
    title: string;
    /** Shown in mono after the title, for example the number of rows below. */
    count?: number | string;
    /** The heading element. Sections are labelled, not shouted, so every level looks the same. */
    as?: "h1" | "h2" | "h3" | "h4";
    class?: HTMLAttributes["class"];
  }>(),
  { as: "h2" },
);

defineSlots<{ actions?: () => unknown }>();
</script>

<template>
  <div
    data-slot="section-header"
    :class="cn('flex min-h-9 flex-wrap items-center gap-x-3 gap-y-2', props.class)"
  >
    <component :is="as" class="flex items-baseline gap-2 text-sm font-medium text-foreground">
      {{ title }}
      <span
        v-if="count !== undefined"
        data-slot="section-header-count"
        class="font-mono text-xs font-normal text-muted-foreground"
        >{{ count }}</span
      >
    </component>
    <div v-if="$slots.actions" data-slot="section-header-actions" class="ml-auto flex gap-2">
      <slot name="actions" />
    </div>
  </div>
</template>
