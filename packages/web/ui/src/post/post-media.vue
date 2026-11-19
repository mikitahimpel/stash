<script setup lang="ts">
import { computed, ref } from "vue";
import PostLightbox from "./post-lightbox.vue";
import * as PostMedia from "./post-media";
import PostVideo from "./post-video.vue";

// The media of a post in one rounded box: a single photo or video in its own shape (within
// limits), two side by side, three as one tall and two small, four as a 2×2 grid. A photo opens
// the lightbox on itself; a video plays in place. Everything is remote and loads lazily, without
// a referrer. `compact` is the box of a quoted post: never taller than 16:9.
const props = withDefaults(
  defineProps<{ media: ReadonlyArray<PostMedia.Media>; compact?: boolean }>(),
  { compact: false },
);

const shown = computed(() => props.media.slice(0, PostMedia.maxMedia));
const photos = computed(() => shown.value.filter((item) => item.kind === "photo"));
const open = ref<number | null>(null);
const failed = ref<ReadonlySet<string>>(new Set());

const boxStyle = computed(() => {
  const [only] = shown.value;
  return shown.value.length === 1 && only !== undefined
    ? {
        aspectRatio: String(
          props.compact ? Math.max(16 / 9, PostMedia.ratio(only)) : PostMedia.ratio(only),
        ),
      }
    : { aspectRatio: "16 / 9" };
});
</script>

<template>
  <div
    v-if="shown.length > 0"
    data-slot="post-media"
    :data-count="shown.length"
    :style="boxStyle"
    :class="[
      'grid w-full gap-0.5 overflow-hidden rounded-surface border border-hairline bg-sunken',
      shown.length === 1 ? 'grid-cols-1' : 'grid-cols-2',
      shown.length > 2 && 'grid-rows-2',
    ]"
  >
    <div
      v-for="(item, i) in shown"
      :key="i"
      :class="['relative min-h-0 min-w-0', shown.length === 3 && i === 0 && 'row-span-2']"
    >
      <button
        v-if="item.kind === 'photo'"
        type="button"
        data-slot="post-photo"
        :aria-label="
          photos.length === 1
            ? 'Open photo'
            : `Open photo ${photos.indexOf(item) + 1} of ${photos.length}`
        "
        class="block size-full cursor-zoom-in outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset"
        @click="open = photos.indexOf(item)"
      >
        <img
          v-if="!failed.has(item.url)"
          :src="item.url"
          alt=""
          loading="lazy"
          decoding="async"
          referrerpolicy="no-referrer"
          class="size-full object-cover"
          @error="failed = new Set([...failed, item.url])"
        />
      </button>
      <PostVideo v-else :video="item" />
    </div>
    <PostLightbox v-model:index="open" :photos="photos" />
  </div>
</template>
