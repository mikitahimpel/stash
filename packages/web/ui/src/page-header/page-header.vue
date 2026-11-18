<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { cn } from "../cn";

const props = defineProps<{
  title: string;
  /**
   * One muted line under the title, for example `6 unread · 159 saved in 30 days`. A page whose
   * line comes with its data passes `""` until it has it (and when there is nothing to say): the
   * line keeps its place, so the header is one height in every state of the page.
   */
  subtitle?: string;
  class?: HTMLAttributes["class"];
}>();

defineSlots<{ actions?: () => unknown }>();
</script>

<template>
  <header
    data-slot="page-header"
    :class="cn('mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-4', props.class)"
  >
    <!-- The one page heading: 28px/600 with a muted line under it and the page's primary action on
         the right. `mb-6` plus the page's 24px gap makes the 48px above the content. Sections below
         it use <SectionHeader />. -->
    <div class="flex min-w-0 flex-col gap-1">
      <h1 class="text-title text-foreground">
        {{ title }}
      </h1>
      <p
        v-if="subtitle !== undefined"
        data-slot="page-header-subtitle"
        class="min-h-5 text-body text-muted-foreground"
      >
        {{ subtitle }}
      </p>
    </div>
    <div
      v-if="$slots.actions"
      data-slot="page-header-actions"
      class="flex flex-wrap items-center gap-2 max-sm:w-full"
    >
      <slot name="actions" />
    </div>
  </header>
</template>
