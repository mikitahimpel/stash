<script setup lang="ts">
import { Primitive, type PrimitiveProps } from "reka-ui";

const props = withDefaults(defineProps<PrimitiveProps>(), { as: "span" });

// `stash`, in the app bar and on the login screen. `as-child` puts it on a RouterLink.
</script>

<template>
  <Primitive
    data-slot="wordmark"
    :as="props.as"
    :as-child="props.asChild"
    class="text-base font-semibold tracking-tight text-foreground"
  >
    <slot>stash</slot>
  </Primitive>
</template>
