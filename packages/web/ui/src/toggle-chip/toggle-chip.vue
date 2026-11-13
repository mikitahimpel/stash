<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { cn } from "../cn";
import {
  type ControlSize,
  controlBase,
  controlSizes,
  controlSurfaces,
} from "../control/control-variants";

// A toggle filter in the control language: sunken while off, raised (a key that is up) while on.
const props = withDefaults(
  defineProps<{ size?: ControlSize; class?: HTMLAttributes["class"]; disabled?: boolean }>(),
  { size: "sm" },
);
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
        controlBase,
        controlSizes[size],
        pressed
          ? controlSurfaces.raised
          : [controlSurfaces.sunken, 'text-muted-foreground hover:text-foreground'],
        props.class,
      )
    "
    @click="pressed = !pressed"
  >
    <slot />
  </button>
</template>
