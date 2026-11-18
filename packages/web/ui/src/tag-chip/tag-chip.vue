<script setup lang="ts">
import { Primitive, type PrimitiveProps } from "reka-ui";

// A tag on a row: a subtle 24px chip, 13px muted. `as-child` puts it on a link;
// it sits above the row's own target.
const props = withDefaults(defineProps<PrimitiveProps>(), { as: "span" });
</script>

<template>
  <Primitive
    data-slot="tag-chip"
    :as="props.as"
    :as-child="props.asChild"
    class="relative inline-flex h-6 shrink-0 items-center rounded-control bg-secondary px-2 text-meta whitespace-nowrap text-muted-foreground transition-colors [a&]:hover:text-foreground [button&]:cursor-pointer [button&]:hover:text-foreground"
  >
    <slot />
  </Primitive>
</template>
