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
  <div
    data-slot="empty-state"
    :class="
      cn(
        'flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center',
        props.class,
      )
    "
  >
    <div
      v-if="$slots.icon"
      data-slot="empty-state-icon"
      class="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground [&_svg]:size-6"
    >
      <slot name="icon" />
    </div>
    <h3 class="text-base font-semibold">{{ title }}</h3>
    <p v-if="description" class="max-w-sm text-sm text-muted-foreground">{{ description }}</p>
    <slot />
    <div v-if="$slots.action" data-slot="empty-state-action" class="mt-2">
      <slot name="action" />
    </div>
  </div>
</template>
