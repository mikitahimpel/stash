<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { cn } from "../cn";

const props = defineProps<{ class?: HTMLAttributes["class"] }>();
const model = defineModel<string | number>();
</script>

<template>
  <input
    v-model="model"
    data-slot="input"
    :class="
      cn(
        'flex h-10 w-full min-w-0 rounded-lg px-3 py-1 text-sm text-foreground tactile-sunken transition-[color,box-shadow] placeholder:text-muted-foreground selection:bg-foreground selection:text-background file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-[13px] file:font-medium file:text-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 sm:h-9',
        'aria-invalid:border-destructive',
        props.class,
      )
    "
  />
</template>
