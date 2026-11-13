<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { cn } from "../cn";

const props = defineProps<{ class?: HTMLAttributes["class"] }>();
</script>

<template>
  <kbd
    data-slot="kbd"
    :class="
      cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-sm px-1 font-mono text-key font-medium text-foreground tactile-key',
        props.class,
      )
    "
  >
    <slot />
  </kbd>
</template>
