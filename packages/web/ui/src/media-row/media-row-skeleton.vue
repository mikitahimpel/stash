<script setup lang="ts">
import Skeleton from "../skeleton/skeleton.vue";
import MediaRow from "./media-row.vue";

// A media row that is still loading: the real `<MediaRow>` with placeholder blocks in its slots,
// so it has the row's exact box (114px from `sm` up; 120px on phones with a tags line and 88px
// without), preview, lines and gaps, and nothing moves when the rows arrive. `tags` as the list's
// rows have it: on for links, off for open tabs.
withDefaults(defineProps<{ as?: string; tags?: boolean }>(), { as: "div", tags: false });
</script>

<template>
  <MediaRow
    :as="as"
    data-skeleton=""
    class="pointer-events-none"
    v-bind="{ 'aria-hidden': 'true' }"
  >
    <template #thumb><Skeleton shape="thumb" /></template>
    <template #title><Skeleton class="w-3/5" /></template>
    <template #meta><Skeleton class="w-2/5" /></template>
    <template #summary><Skeleton class="w-4/5" /></template>
    <template v-if="tags" #tags>
      <div class="flex gap-1"><Skeleton shape="tag" /><Skeleton shape="tag" /></div>
    </template>
  </MediaRow>
</template>
