<script setup lang="ts">
import { computed, ref } from "vue";
import MediaFit from "../media-fit/media-fit.vue";
import * as MediaShape from "../media-fit/media-shape";
import PostLightbox from "./post-lightbox.vue";
import * as PostMedia from "./post-media";
import PostVideo from "./post-video.vue";

// The media of a post in one rounded box: a single photo or video in its own shape, two side by
// side, three as one tall and two small, four as a 2×2 grid. A photo opens the lightbox on
// itself; a video plays in place. Everything is remote and loads lazily, without a referrer.
// `compact` is the box of a quoted post: never taller than 16:9.
//
// A single medium is shown whole (#176): its box has its shape and is never taller than
// `min(70vh, 640px)`, so a portrait photo or video stands in the middle of the card's width over
// a blurred copy of itself (`<MediaFit>`). In a grid the cells keep their shape and a photo is
// cropped from its upper third; the lightbox shows the whole photo.
const props = withDefaults(
  defineProps<{ media: ReadonlyArray<PostMedia.Media>; compact?: boolean }>(),
  { compact: false },
);

const shown = computed(() => props.media.slice(0, PostMedia.maxMedia));
const photos = computed(() => shown.value.filter((item) => item.kind === "photo"));
const open = ref<number | null>(null);
const failed = ref<ReadonlySet<string>>(new Set());

const single = computed(() => (shown.value.length === 1 ? shown.value[0] : undefined));
const boxStyle = computed(() =>
  single.value === undefined
    ? { aspectRatio: "16 / 9" }
    : {
        aspectRatio: String(PostMedia.boxRatio(single.value, props.compact)),
        maxHeight: MediaShape.maxHeight,
      },
);
/** How a medium sits in its cell: whole when it is the only one, filling a cell of a grid. */
const fit = computed(() =>
  single.value === undefined
    ? "cover"
    : PostMedia.ratio(single.value) === undefined
      ? "auto"
      : "contain",
);
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
        class="relative block size-full cursor-zoom-in outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset"
        @click="open = photos.indexOf(item)"
      >
        <MediaFit
          v-if="!failed.has(item.url)"
          :src="item.url"
          :aspect="PostMedia.ratio(item)"
          :fit="fit"
          @error="failed = new Set([...failed, item.url])"
        />
      </button>
      <PostVideo v-else :video="item" :fit="fit" />
    </div>
    <PostLightbox v-model:index="open" :photos="photos" />
  </div>
</template>
