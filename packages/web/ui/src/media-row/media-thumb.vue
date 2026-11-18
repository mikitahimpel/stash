<script setup lang="ts">
import { Play } from "@lucide/vue";
import { computed, ref, watch } from "vue";
import * as SiteCover from "./site-cover";

// The preview of a `<MediaRow>`: 16:9, 160×90 (110×62 on phones), radius 8. A video carries a small
// play mark. The image is remote (an `og:image`, a video thumbnail): it loads lazily and without a
// referrer, so the other site learns nothing about this page and hotlink checks by referrer pass.
//
// With no image, or one that fails to load, the tile is a generated cover (#155): a soft gradient
// in a hue of the site's own (a stable hash of its host, toned for each theme in `styles.css`),
// the site's favicon in the centre and its host small at the bottom. The favicon loads like the
// image does; without one (or without a `url`) the site's initial takes its place.
const props = withDefaults(
  defineProps<{
    /** The image. Decorative: the title names the link. */
    src?: string | null | undefined;
    /** The link's or tab's URL: the cover's host, favicon and hue come from it. */
    url?: string | undefined;
    /** Shown when there is no favicon: the first letter of this. Defaults to the url's host. */
    initial?: string | undefined;
    video?: boolean;
  }>(),
  { src: undefined, url: undefined, initial: undefined, video: false },
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
const coverStyle = computed(() =>
  image.value === undefined && host.value !== ""
    ? { "--cover-hue": String(SiteCover.hue(host.value)) }
    : undefined,
);
</script>

<template>
  <span
    data-slot="media-thumb"
    :data-empty="image === undefined ? '' : undefined"
    :data-cover="coverStyle === undefined ? undefined : ''"
    :style="coverStyle"
    :class="[
      'relative flex h-[62px] w-[110px] flex-col items-center justify-center gap-0.5 overflow-hidden rounded-control text-row-title uppercase after:absolute after:inset-0 after:rounded-control after:border after:border-foreground/10 sm:h-[90px] sm:w-[160px] sm:gap-1',
      coverStyle === undefined ? 'bg-sunken text-muted-foreground' : 'media-cover',
    ]"
  >
    <img
      v-if="image !== undefined"
      :src="image"
      alt=""
      loading="lazy"
      decoding="async"
      referrerpolicy="no-referrer"
      class="size-full object-cover"
      @error="failed = true"
    />
    <template v-else>
      <img
        v-if="icon !== null"
        data-slot="media-cover-icon"
        :src="icon"
        alt=""
        loading="lazy"
        decoding="async"
        referrerpolicy="no-referrer"
        class="size-5 rounded-[4px] object-contain sm:size-7 sm:rounded-[6px]"
        @error="iconFailed = true"
      />
      <span v-else data-slot="media-cover-initial" aria-hidden="true">{{ letter }}</span>
      <span
        v-if="host !== ''"
        data-slot="media-cover-host"
        aria-hidden="true"
        class="max-w-full truncate px-1.5 text-[10px]/3 font-medium tracking-normal normal-case sm:text-[11px]/[14px]"
        >{{ host }}</span
      >
    </template>
    <span
      v-if="props.video"
      data-slot="media-thumb-video"
      aria-hidden="true"
      class="absolute bottom-1 left-1 flex size-4 items-center justify-center rounded-sm bg-black/70 text-white sm:size-5"
    >
      <Play class="size-2.5 fill-current" />
    </span>
  </span>
</template>
