<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { cn } from "../cn";

const props = defineProps<{ class?: HTMLAttributes["class"] }>();
</script>

<template>
  <!-- Numbered steps of a guide, each a <Step>: 16px apart. -->
  <ol data-slot="step-list" :class="cn('flex flex-col gap-4', props.class)">
    <slot />
  </ol>
</template>
