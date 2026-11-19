<script setup lang="ts">
import Skeleton from "../skeleton/skeleton.vue";
import CompactRow from "./compact-row.vue";

// A compact row that is still loading: the real `<CompactRow>` with placeholder blocks in its
// slots, so it has the row's exact box (48px) and nothing moves when the rows arrive.
withDefaults(defineProps<{ as?: string }>(), { as: "div" });
</script>

<template>
  <CompactRow
    :as="as"
    data-skeleton=""
    class="pointer-events-none"
    v-bind="{ 'aria-hidden': 'true' }"
  >
    <template #leading><Skeleton shape="icon" /></template>
    <template #title><Skeleton class="w-3/5" /></template>
    <template #meta><Skeleton class="w-1/4" /></template>
  </CompactRow>
</template>
