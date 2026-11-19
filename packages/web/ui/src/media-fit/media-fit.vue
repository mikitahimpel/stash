<script setup lang="ts">
import { computed, ref, watch } from "vue";
import * as MediaShape from "./media-shape";

// A remote picture in a box of any shape (#176), filling its positioned parent. It is the one way
// the kit draws a preview, a poster or a photo.
//
// Media close to the box's shape fill it (`object-fit: cover`), and what has to be cropped is
// taken from the bottom rather than the top: the picture is anchored to its upper third, where
// faces usually are. Media of another shape (a portrait or a square in a 16:9 box, a panorama)
// are shown whole in a frame of their own shape in the middle of the box, over a blurred, darkened
// copy of the picture that fills the rest, the way Telegram and Apple Photos letterbox.
//
// The shape comes from `aspect` when the caller knows it (a post's media carry their size), and is
// otherwise measured when the picture has loaded. The box never changes size either way: only what
// is drawn inside it does. The backdrop is a second `<img>` of the same address (one request)
// with a CSS blur; nothing is drawn on a canvas.
//
// The default slot is drawn in the frame, over the picture: a player takes the frame's exact
// place. Everything loads without a referrer.
const props = withDefaults(
  defineProps<{
    /** The picture. With none, only the frame (and its slot) is there. */
    src?: string | null | undefined;
    /** The width over the height of the media, when known. Measured on load otherwise. */
    aspect?: number | null | undefined;
    /** The nominal ratio of the box, which decides whether the media are close to its shape. */
    box?: number;
    /**
     * `auto`: by the shape. `contain`: always whole (a box whose height is capped is not of the
     * shape it was reserved with). `cover`: always filled (a cell of a grid).
     */
    fit?: "auto" | "contain" | "cover";
    /** Load the picture only when it is near the screen. */
    lazy?: boolean;
  }>(),
  { src: undefined, aspect: undefined, box: MediaShape.wide, fit: "auto", lazy: true },
);
const emit = defineEmits<{ error: [] }>();

const measured = ref<number>();
watch(
  () => props.src,
  () => (measured.value = undefined),
);
const onLoad = (event: Event) => {
  const image = event.target as HTMLImageElement;
  measured.value = MediaShape.ratio(image.naturalWidth, image.naturalHeight);
};

const shape = computed(() =>
  typeof props.aspect === "number" && props.aspect > 0 ? props.aspect : measured.value,
);
/** The ratio of the frame the media are shown whole in, or `undefined` while they fill the box. */
const frame = computed(() =>
  props.fit === "cover" || shape.value === undefined
    ? undefined
    : props.fit === "contain" || MediaShape.fit(shape.value, props.box) === "contain"
      ? shape.value
      : undefined,
);
// As wide as the box, or as wide as its height allows: the largest frame of the shape that fits.
const frameStyle = computed(() =>
  frame.value === undefined
    ? undefined
    : { width: `min(100cqw, 100cqh * ${frame.value})`, aspectRatio: String(frame.value) },
);
const hasImage = computed(() => typeof props.src === "string" && props.src !== "");
</script>

<template>
  <span
    data-slot="media-fit"
    :data-fit="frame === undefined ? 'cover' : 'contain'"
    class="absolute inset-0 block overflow-hidden [container-type:size]"
  >
    <img
      v-if="hasImage && frame !== undefined"
      data-slot="media-fit-backdrop"
      :src="src!"
      alt=""
      aria-hidden="true"
      :loading="lazy ? 'lazy' : undefined"
      decoding="async"
      referrerpolicy="no-referrer"
      class="media-backdrop absolute inset-0 size-full object-cover"
    />
    <span
      data-slot="media-fit-frame"
      :style="frameStyle"
      :class="[
        'absolute top-1/2 left-1/2 block -translate-x-1/2 -translate-y-1/2 overflow-hidden',
        frame === undefined && 'size-full',
      ]"
    >
      <img
        v-if="hasImage"
        data-slot="media-fit-image"
        :src="src!"
        alt=""
        :loading="lazy ? 'lazy' : undefined"
        decoding="async"
        referrerpolicy="no-referrer"
        class="block size-full object-cover object-[50%_30%]"
        @load="onLoad"
        @error="emit('error')"
      />
      <slot />
    </span>
  </span>
</template>
