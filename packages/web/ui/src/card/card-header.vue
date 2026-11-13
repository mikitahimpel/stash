<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { cn } from "../cn";

const props = defineProps<{ class?: HTMLAttributes["class"] }>();
</script>

<template>
  <div
    data-slot="card-header"
    :class="cn('flex min-h-control-lg flex-col justify-center gap-1', props.class)"
  >
    <slot />
  </div>
</template>
