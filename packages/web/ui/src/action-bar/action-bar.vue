<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { cn } from "../cn";

// The actions of one item on its own page (a link: Mark seen, Mark done, Archive). From `sm` up it
// is a row of buttons where it stands. On phones it is a bar fixed to the bottom of the screen,
// right above the nav bar (48px and its hairline), 56px tall, with its buttons sharing the width.
// `<AppMain>` pads its bottom by the bar's height while it holds one (`styles.css`), so the end of
// the page clears it.
const props = defineProps<{
  /** Names the group for screen readers, for example `Link actions`. */
  label: string;
  class?: HTMLAttributes["class"];
}>();
</script>

<template>
  <div
    data-slot="action-bar"
    role="group"
    :aria-label="props.label"
    :class="
      cn(
        'flex flex-wrap items-center gap-2 max-sm:fixed max-sm:inset-x-0 max-sm:bottom-[calc(49px+env(safe-area-inset-bottom))] max-sm:z-10 max-sm:h-14 max-sm:flex-nowrap max-sm:border-t max-sm:border-hairline max-sm:bg-background max-sm:px-4 max-sm:[&>*]:min-w-0 max-sm:[&>*]:flex-1',
        props.class,
      )
    "
  >
    <slot />
  </div>
</template>
