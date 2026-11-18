<script setup lang="ts">
import { Play } from "@lucide/vue";
import { computed, ref, watch } from "vue";
import * as SiteCover from "../media-row/site-cover";

// The preview at the top of a link's own page: 16:9, as wide as its column, radius 12 like a
// surface. On phones it runs from one screen edge to the other, without the radius. It is the
// `<MediaThumb>` of a row at full size: the remote image (lazy, no referrer), or the generated
// cover when there is none or it fails to load (the site's hue, its favicon or initial, its host).
//
// With `embed` (a player's URL) it carries a play button, and pressing it, or anywhere on the
// preview, swaps the player in. The player is an `<iframe>` that exists only after that press, so
// the other site learns nothing until the user asks for the video.
const props = withDefaults(
  defineProps<{
    /** The image. Decorative: the page's title names the link. */
    src?: string | null | undefined;
    /** The link's URL: the cover's host, favicon and hue come from it. */
    url?: string | undefined;
    /** Shown when there is no favicon: the first letter of this. Defaults to the url's host. */
    initial?: string | undefined;
    /** The URL of an embedded player. Loaded only once the play button is pressed. */
    embed?: string | undefined;
    /** Names the player for screen readers: the link's title. */
    title?: string | undefined;
  }>(),
  { src: undefined, url: undefined, initial: undefined, embed: undefined, title: undefined },
);

const failed = ref(false);
watch(
  () => props.src,
  () => (failed.value = false),
);
const image = computed(() =>
  props.src === undefined || props.src === null || props.src === "" || failed.value
    ? undefined
    : props.src,
);

const host = computed(() => (props.url === undefined ? "" : SiteCover.host(props.url)));
const iconFailed = ref(false);
watch(
  () => props.url,
  () => (iconFailed.value = false),
);
const icon = computed(() =>
  props.url === undefined || iconFailed.value ? null : SiteCover.favicon(props.url),
);
const letter = computed(() => (props.initial ?? host.value).slice(0, 1));

const playing = ref(false);
watch(
  () => props.embed,
  () => (playing.value = false),
);
const player = computed(() => (playing.value ? props.embed : undefined));
const play = () => {
  if (props.embed !== undefined) playing.value = true;
};

const cover = computed(() => image.value === undefined && player.value === undefined);
const coverStyle = computed(() =>
  cover.value && host.value !== ""
    ? { "--cover-hue": String(SiteCover.hue(host.value)) }
    : undefined,
);
</script>

<template>
  <div
    data-slot="media-hero"
    :data-empty="image === undefined ? '' : undefined"
    :data-cover="coverStyle === undefined ? undefined : ''"
    :data-playing="player === undefined ? undefined : ''"
    :style="coverStyle"
    :class="[
      'relative flex aspect-video flex-col items-center justify-center gap-2 overflow-hidden rounded-surface after:pointer-events-none after:absolute after:inset-0 after:rounded-surface after:border after:border-foreground/10 max-sm:-mx-4 max-sm:rounded-none max-sm:after:hidden',
      coverStyle === undefined ? 'bg-sunken text-muted-foreground' : 'media-cover',
      embed !== undefined && player === undefined && 'cursor-pointer',
    ]"
    @click="play"
  >
    <iframe
      v-if="player !== undefined"
      data-slot="media-hero-player"
      :src="player"
      :title="title ?? 'Video player'"
      allow="
        accelerometer;
        autoplay;
        clipboard-write;
        encrypted-media;
        gyroscope;
        picture-in-picture;
        web-share;
      "
      allowfullscreen
      referrerpolicy="strict-origin-when-cross-origin"
      class="absolute inset-0 size-full border-0"
    />
    <template v-else>
      <img
        v-if="image !== undefined"
        :src="image"
        alt=""
        decoding="async"
        referrerpolicy="no-referrer"
        class="absolute inset-0 size-full object-cover"
        @error="failed = true"
      />
      <button
        v-if="embed !== undefined"
        type="button"
        data-slot="media-hero-play"
        :aria-label="title === undefined ? 'Play video' : `Play ${title}`"
        class="relative hit-area flex h-control-lg w-16 shrink-0 cursor-pointer items-center justify-center rounded-control bg-black/70 text-white transition-colors hover:bg-black/85"
        @click.stop="play"
      >
        <Play aria-hidden="true" class="size-5 fill-current" />
      </button>
      <template v-if="image === undefined">
        <template v-if="embed === undefined">
          <img
            v-if="icon !== null"
            data-slot="media-cover-icon"
            :src="icon"
            alt=""
            decoding="async"
            referrerpolicy="no-referrer"
            class="size-12 rounded-control object-contain"
            @error="iconFailed = true"
          />
          <span
            v-else
            data-slot="media-cover-initial"
            aria-hidden="true"
            class="text-title uppercase"
            >{{ letter }}</span
          >
        </template>
        <span
          v-if="host !== ''"
          data-slot="media-cover-host"
          aria-hidden="true"
          class="max-w-full truncate px-4 text-label"
          >{{ host }}</span
        >
      </template>
    </template>
  </div>
</template>
