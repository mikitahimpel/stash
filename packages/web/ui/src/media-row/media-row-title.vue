<script setup lang="ts">
import { Primitive, type PrimitiveProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { cn } from "../cn";

interface Props extends PrimitiveProps {
  class?: HTMLAttributes["class"];
}

// The title of a `<MediaRow>`: 15/600, two lines at most. `as-child` puts it on a `<RouterLink>`
// or `<a>`; its `::after` covers the whole row, so the row is one target. Other links in the row
// (a tag, the host) sit above it with `relative`.
const props = withDefaults(defineProps<Props>(), { as: "span" });
</script>

<template>
  <Primitive
    data-slot="media-row-title"
    :as="as"
    :as-child="asChild"
    :class="
      cn(
        'line-clamp-2 min-w-0 text-row-title text-foreground outline-none after:absolute after:inset-0 after:rounded-surface',
        props.class,
      )
    "
  >
    <slot />
  </Primitive>
</template>
