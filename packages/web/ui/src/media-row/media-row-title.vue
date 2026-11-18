<script setup lang="ts">
import { Primitive, type PrimitiveProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { cn } from "../cn";

interface Props extends PrimitiveProps {
  /**
   * Whether the title's target covers the whole row. Off for a row that a click selects (an open
   * tab), where only the title itself opens the link.
   */
  stretch?: boolean;
  class?: HTMLAttributes["class"];
}

// The title of a `<MediaRow>`: 15/600, one line with an ellipsis (two lines at most on phones); put
// the whole title in its `title` attribute. `as-child` puts it on a `<RouterLink>`
// or `<a>`; its `::after` covers the whole row, so the row is one target. Other links in the row
// (a tag, the host) sit above it with `relative`.
const props = withDefaults(defineProps<Props>(), { as: "span", stretch: true });
</script>

<template>
  <Primitive
    data-slot="media-row-title"
    :data-stretch="stretch ? '' : undefined"
    :as="as"
    :as-child="asChild"
    :class="
      cn(
        'line-clamp-2 min-w-0 sm:line-clamp-1 text-row-title break-words text-foreground outline-none',
        stretch ? 'after:absolute after:inset-0 after:rounded-surface' : 'relative',
        props.class,
      )
    "
  >
    <slot />
  </Primitive>
</template>
