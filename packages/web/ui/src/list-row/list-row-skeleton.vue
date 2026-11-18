<script setup lang="ts">
import Skeleton from "../skeleton/skeleton.vue";
import StatusDot from "../status-dot/status-dot.vue";
import ListRow from "./list-row.vue";

// A list row that is still loading: the real `<ListRow>` with placeholder blocks in its slots, so
// it has the row's exact box (a 36px title line; on phones the meta goes under it) and nothing
// moves when the rows arrive. `leading` and `trailing` as the list's rows have them: a status dot
// before the title, one `sm` button at the end.
withDefaults(defineProps<{ as?: string; leading?: boolean; trailing?: boolean }>(), {
  as: "div",
  leading: false,
  trailing: false,
});
</script>

<template>
  <ListRow :as="as" data-skeleton="" class="pointer-events-none" v-bind="{ 'aria-hidden': 'true' }">
    <template v-if="leading" #leading><StatusDot tone="muted" /></template>
    <template #title>
      <div class="flex h-control-md min-w-0 items-center sm:flex-1"><Skeleton class="w-40" /></div>
    </template>
    <template #meta><Skeleton class="w-32" /></template>
    <template v-if="trailing" #trailing><Skeleton shape="chip" /></template>
  </ListRow>
</template>
