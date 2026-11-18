<script setup lang="ts">
import { computed, ref, watch } from "vue";

// The compact preview of a `<MediaRow>` that has no picture of its own (an open tab): a 32px
// sunken tile with the site's favicon at 16px. With no icon, or one that fails to load, it shows
// the site's initial. The icon is remote: it loads lazily and without a referrer, so the other
// site learns nothing about this page.
const props = withDefaults(
  defineProps<{
    /** The favicon. Decorative: the row's meta line names the site. */
    src?: string | null | undefined;
    /** Shown when there is no icon: the first letter of the site. */
    initial?: string;
  }>(),
  { src: undefined, initial: "" },
);

const failed = ref(false);
watch(
  () => props.src,
  () => (failed.value = false),
);
const icon = computed(() =>
  props.src === undefined || props.src === null || props.src === "" || failed.value
    ? undefined
    : props.src,
);
</script>

<template>
  <span
    data-slot="site-icon"
    :data-empty="icon === undefined ? '' : undefined"
    class="relative mt-1 flex size-8 items-center justify-center overflow-hidden rounded-control bg-sunken text-label text-muted-foreground uppercase after:absolute after:inset-0 after:rounded-control after:border after:border-foreground/10"
  >
    <img
      v-if="icon !== undefined"
      :src="icon"
      alt=""
      width="16"
      height="16"
      loading="lazy"
      decoding="async"
      referrerpolicy="no-referrer"
      class="size-4 rounded-[3px] object-contain"
      @error="failed = true"
    />
    <span v-else aria-hidden="true">{{ props.initial.slice(0, 1) }}</span>
  </span>
</template>
