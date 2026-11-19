<script setup lang="ts">
import { Check } from "@lucide/vue";
import type { HTMLAttributes } from "vue";
import { cn } from "../cn";

// A checkbox for picking a row: a 16px box in a 32px target (44px on phones), so it sits in a
// row's 20px mark place without moving the text beside it.
const props = defineProps<{
  /** Names what it picks for screen readers, for example `Select Example article`. */
  label: string;
  class?: HTMLAttributes["class"];
}>();
const checked = defineModel<boolean>("checked", { default: false });
</script>

<template>
  <button
    type="button"
    role="checkbox"
    data-slot="check-toggle"
    :aria-checked="checked"
    :aria-label="props.label"
    :class="
      cn(
        'group/check relative hit-area flex size-control-sm shrink-0 items-center justify-center rounded-control outline-none focus-visible:outline-2 focus-visible:outline-ring/40',
        props.class,
      )
    "
    @click.stop="checked = !checked"
  >
    <span
      aria-hidden="true"
      :class="[
        'flex size-4 items-center justify-center rounded-[4px] border transition-colors',
        checked
          ? 'border-foreground bg-foreground text-background'
          : 'border-muted-foreground/60 bg-background group-hover/check:border-foreground',
      ]"
    >
      <Check v-if="checked" class="size-3" :stroke-width="3" />
    </span>
  </button>
</template>
