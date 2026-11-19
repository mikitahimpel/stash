<script setup lang="ts">
import { ref, watch } from "vue";
import MediaFit from "../media-fit/media-fit.vue";

// The small preview at the end of a `<CompactRow>` (a tab that is saved, with its link's image):
// 16:9, 64×36, inside the row's height. A remote picture, drawn by `<MediaFit>` like every other.
// It takes no room when the picture fails to load.
const props = defineProps<{
  /** The image. Decorative: the row's title names it. */
  src: string;
  aspect?: number | null | undefined;
}>();

const failed = ref(false);
watch(
  () => props.src,
  () => (failed.value = false),
);
</script>

<template>
  <span
    v-if="!failed"
    data-slot="compact-row-thumb"
    class="relative block h-9 w-16 shrink-0 overflow-hidden rounded-[4px] bg-sunken after:absolute after:inset-0 after:rounded-[4px] after:border after:border-foreground/10"
  >
    <MediaFit :src="src" :aspect="aspect" @error="failed = true" />
  </span>
</template>
