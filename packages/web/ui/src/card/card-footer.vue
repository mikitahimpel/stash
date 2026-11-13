<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { cn } from "../cn";

const props = defineProps<{ class?: HTMLAttributes["class"] }>();
</script>

<template>
  <div data-slot="card-footer" :class="cn('flex min-h-control-lg items-center gap-2', props.class)">
    <slot />
  </div>
</template>
