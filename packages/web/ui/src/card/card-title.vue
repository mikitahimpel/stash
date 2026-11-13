<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { cn } from "../cn";

const props = withDefaults(
  defineProps<{ as?: "h2" | "h3" | "h4"; class?: HTMLAttributes["class"] }>(),
  { as: "h3" },
);
</script>

<template>
  <component :is="as" data-slot="card-title" :class="cn('text-label', props.class)">
    <slot />
  </component>
</template>
