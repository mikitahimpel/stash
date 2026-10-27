<script setup lang="ts">
import { Primitive, type PrimitiveProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { cn } from "../cn";

interface Props extends PrimitiveProps {
  /** The row the keyboard is on. It lifts out of the list and shows its `actions`. */
  selected?: boolean;
  class?: HTMLAttributes["class"];
}

const props = withDefaults(defineProps<Props>(), { as: "div", selected: false });

defineSlots<{
  default?: () => unknown;
  /** The row action bar, shown while the row is selected. */
  actions?: () => unknown;
}>();
</script>

<template>
  <Primitive
    data-slot="list-row"
    :data-state="selected ? 'selected' : undefined"
    :as="as"
    :as-child="asChild"
    :class="
      cn(
        'flex flex-col gap-2 border border-transparent border-b-hairline-row px-3 py-2.5',
        selected && 'tactile-row-selected',
        props.class,
      )
    "
  >
    <slot />
    <div
      v-if="selected && $slots.actions"
      data-slot="list-row-actions"
      class="flex flex-wrap items-center gap-2"
    >
      <slot name="actions" />
    </div>
  </Primitive>
</template>
