<script setup lang="ts">
import { Primitive, type PrimitiveProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { cn } from "../cn";

interface Props extends PrimitiveProps {
  /** A row that only says something is missing (`No devices yet`): body text, muted. */
  muted?: boolean;
  class?: HTMLAttributes["class"];
}

// `as-child` puts the look on a `<RouterLink>` or `<a>` passed in the slot. A link title is the
// row's target (`data-row`): no underline, the row's background shows hover and focus.
const props = withDefaults(defineProps<Props>(), { as: "span", muted: false });
</script>

<template>
  <Primitive
    data-slot="list-row-title"
    data-row=""
    :as="as"
    :as-child="asChild"
    :class="
      cn(
        'relative hit-area block h-control-md min-w-0 truncate text-label leading-(--spacing-control-md) text-foreground outline-none sm:flex-1',
        muted && 'text-body text-muted-foreground',
        props.class,
      )
    "
  >
    <slot />
  </Primitive>
</template>
