<script setup lang="ts">
import { ChevronLeft, ChevronRight, X } from "@lucide/vue";
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from "reka-ui";
import { computed } from "vue";
import type * as PostMedia from "./post-media";

// A post's photos, one at a time, over the whole screen: the photo as large as it fits, a counter,
// and Previous / Next (also ← and →) when there is more than one. Esc, the Close button and a
// click beside the photo close it. Photos load without a referrer.
const props = defineProps<{ photos: ReadonlyArray<PostMedia.Photo> }>();
/** The index of the photo shown, or `null` while closed. */
const index = defineModel<number | null>("index", { required: true });

const open = computed({
  get: () => index.value !== null,
  set: (value) => {
    if (!value) index.value = null;
  },
});
const photo = computed(() => (index.value === null ? undefined : props.photos[index.value]));
const step = (by: number) => {
  if (index.value === null || props.photos.length < 2) return;
  index.value = (index.value + by + props.photos.length) % props.photos.length;
};

const control =
  "hit-area inline-flex size-control-md shrink-0 cursor-pointer items-center justify-center rounded-control bg-black/60 text-white transition-colors outline-none hover:bg-black/80 focus-visible:ring-2 focus-visible:ring-white/70 [&_svg]:size-4";
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay
        data-slot="post-lightbox-overlay"
        class="fixed inset-0 z-50 bg-black/90 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0"
      />
      <DialogContent data-slot="post-lightbox" class="fixed inset-0 z-50 outline-none">
        <DialogTitle class="sr-only">Photo</DialogTitle>
        <DialogDescription class="sr-only">
          Photo {{ (index ?? 0) + 1 }} of {{ photos.length }}
        </DialogDescription>
        <div
          data-slot="post-lightbox-stage"
          class="relative flex size-full items-center justify-center p-4 sm:p-12"
          @click.self="open = false"
          @keydown.left.prevent="step(-1)"
          @keydown.right.prevent="step(1)"
        >
          <img
            v-if="photo !== undefined"
            :key="photo.url"
            data-slot="post-lightbox-photo"
            :src="photo.fullUrl ?? photo.url"
            alt=""
            decoding="async"
            referrerpolicy="no-referrer"
            class="max-h-full max-w-full rounded-control object-contain"
          />
          <span
            v-if="photos.length > 1"
            data-slot="post-lightbox-count"
            aria-hidden="true"
            class="absolute top-4 left-4 rounded-control bg-black/60 px-2.5 text-meta/8 text-white tabular-nums"
            >{{ (index ?? 0) + 1 }} / {{ photos.length }}</span
          >
          <DialogClose data-slot="post-lightbox-close" :class="[control, 'absolute top-3 right-3']">
            <X aria-hidden="true" />
            <span class="sr-only">Close</span>
          </DialogClose>
          <template v-if="photos.length > 1">
            <button
              type="button"
              data-slot="post-lightbox-previous"
              aria-label="Previous photo"
              :class="[control, 'absolute top-1/2 left-3 -translate-y-1/2']"
              @click="step(-1)"
            >
              <ChevronLeft aria-hidden="true" />
            </button>
            <button
              type="button"
              data-slot="post-lightbox-next"
              aria-label="Next photo"
              :class="[control, 'absolute top-1/2 right-3 -translate-y-1/2']"
              @click="step(1)"
            >
              <ChevronRight aria-hidden="true" />
            </button>
          </template>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
