<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { cn } from "../cn";

const props = defineProps<{
  title: string;
  /** One mono line of counts under the title, for example `17 tabs · 3 devices`. */
  subtitle?: string;
  class?: HTMLAttributes["class"];
}>();

defineSlots<{ actions?: () => unknown }>();
</script>

<template>
  <!-- The one page heading: 20px/600 with a mono line of counts. Sections below it use
       <SectionHeader />. -->
  <header
    data-slot="page-header"
    :class="cn('flex flex-wrap items-end justify-between gap-x-4 gap-y-3', props.class)"
  >
    <div class="flex min-w-0 flex-col gap-1">
      <h1 class="text-xl leading-7 font-semibold tracking-tight text-foreground">{{ title }}</h1>
      <p
        v-if="subtitle"
        data-slot="page-header-subtitle"
        class="font-mono text-xs text-muted-foreground"
      >
        {{ subtitle }}
      </p>
    </div>
    <div v-if="$slots.actions" data-slot="page-header-actions" class="flex flex-wrap gap-2">
      <slot name="actions" />
    </div>
  </header>
</template>
