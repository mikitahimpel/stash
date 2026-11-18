<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { cn } from "../cn";

// A row of controls (filter menus, a mode switch) that never takes a second line on a phone:
// there it is one line that scrolls sideways, running off both screen edges, with no scrollbar.
// From `sm` up it is an ordinary wrapping row. The phone row is padded (and pulled back by the
// same margins) so the controls' shadows, focus rings and 44px hit areas are not clipped.
const props = defineProps<{ class?: HTMLAttributes["class"] }>();
</script>

<template>
  <div
    data-slot="scroll-row"
    :class="
      cn(
        'flex items-center gap-2 max-sm:-mx-4 max-sm:-my-1.5 max-sm:scroll-px-4 max-sm:overflow-x-auto max-sm:overscroll-x-contain max-sm:px-4 max-sm:py-1.5 max-sm:[scrollbar-width:none] sm:flex-wrap max-sm:[&::-webkit-scrollbar]:hidden max-sm:[&>*]:shrink-0',
        props.class,
      )
    "
  >
    <slot />
  </div>
</template>
