<script setup lang="ts">
import { Primitive, type PrimitiveProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { cn } from "../cn";

interface Props extends PrimitiveProps {
  class?: HTMLAttributes["class"];
}

// The title of a `<CompactRow>`: 14/500 on one line with an ellipsis. `as-child` puts it on an
// `<a>`: only the title opens its link, and a click elsewhere on the row is the row's own.
const props = withDefaults(defineProps<Props>(), { as: "span" });
</script>

<template>
  <Primitive
    data-slot="compact-row-title"
    :as="as"
    :as-child="asChild"
    :class="cn('relative min-w-0 truncate text-label text-foreground outline-none', props.class)"
  >
    <slot />
  </Primitive>
</template>
