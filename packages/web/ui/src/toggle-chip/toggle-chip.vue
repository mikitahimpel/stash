<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { cn } from "../cn";

const props = defineProps<{ class?: HTMLAttributes["class"]; disabled?: boolean }>();
/** On or off. Clicking flips it; screen readers hear it through `aria-pressed`. */
const pressed = defineModel<boolean>("pressed", { default: false });
</script>

<template>
  <button
    type="button"
    data-slot="toggle-chip"
    :data-state="pressed ? 'on' : 'off'"
    :aria-pressed="pressed"
    :disabled="disabled"
    :class="
      cn(
        'inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-[9px] px-3 text-[13px] font-medium whitespace-nowrap transition-[background,box-shadow,color] disabled:pointer-events-none disabled:opacity-50 sm:h-[34px] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-3.5',
        pressed ? 'tactile-pressed' : 'tactile-raised',
        props.class,
      )
    "
    @click="pressed = !pressed"
  >
    <slot />
  </button>
</template>
