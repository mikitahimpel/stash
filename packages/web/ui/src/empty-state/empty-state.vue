<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { cn } from "../cn";

const props = defineProps<{
  title: string;
  description?: string;
  class?: HTMLAttributes["class"];
}>();

defineSlots<{
  icon?: () => unknown;
  default?: () => unknown;
  action?: () => unknown;
}>();
</script>

<template>
  <div data-slot="empty-state" :class="cn('flex flex-col items-start gap-2 py-10', props.class)">
    <div
      v-if="$slots.icon"
      data-slot="empty-state-icon"
      class="text-muted-foreground [&_svg]:size-5"
    >
      <slot name="icon" />
    </div>
    <h3 class="text-sm font-medium">{{ title }}</h3>
    <p v-if="description" class="max-w-prose text-sm text-muted-foreground">{{ description }}</p>
    <slot />
    <div v-if="$slots.action" data-slot="empty-state-action" class="mt-2">
      <slot name="action" />
    </div>
  </div>
</template>
