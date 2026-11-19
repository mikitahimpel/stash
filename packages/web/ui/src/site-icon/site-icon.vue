<script setup lang="ts">
import { computed, ref, watch } from "vue";
import * as SiteCover from "../media-row/site-cover";

// A site's own icon, 20px: `/favicon.ico` on the page's origin, loaded lazily and without a
// referrer, like a preview. Without one (it fails to load, or the url is not a web page) the
// site's initial stands in its place, on the site's hue (the generated cover's, `.media-cover`).
const props = defineProps<{
  /** The link's or tab's URL: the icon, the initial and the hue come from it. */
  url: string;
}>();

const failed = ref(false);
watch(
  () => props.url,
  () => (failed.value = false),
);
const host = computed(() => SiteCover.host(props.url));
const icon = computed(() => (failed.value ? null : SiteCover.favicon(props.url)));
const hue = computed(() =>
  host.value === "" ? undefined : { "--cover-hue": String(SiteCover.hue(host.value)) },
);
</script>

<template>
  <img
    v-if="icon !== null"
    data-slot="site-icon"
    :src="icon"
    alt=""
    loading="lazy"
    decoding="async"
    referrerpolicy="no-referrer"
    class="size-5 shrink-0 rounded-[4px] object-contain"
    @error="failed = true"
  />
  <span
    v-else
    data-slot="site-icon"
    data-initial=""
    aria-hidden="true"
    :style="hue"
    :class="[
      'flex size-5 shrink-0 items-center justify-center rounded-[4px] text-[11px]/none font-semibold uppercase',
      hue === undefined ? 'bg-sunken text-muted-foreground' : 'media-cover',
    ]"
    >{{ (host || "?").slice(0, 1) }}</span
  >
</template>
