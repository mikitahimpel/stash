<script setup lang="ts">
import { Primitive, type PrimitiveProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { cn } from "../cn";

interface Props extends PrimitiveProps {
  class?: HTMLAttributes["class"];
}

// `as-child` styles a `<RouterLink>` (or any other link) passed in the slot instead.
const props = withDefaults(defineProps<Props>(), { as: "a" });
</script>

<template>
  <Primitive
    data-slot="text-link"
    :as="as"
    :as-child="asChild"
    :class="cn('text-foreground link-underline', props.class)"
  >
    <slot />
  </Primitive>
</template>
