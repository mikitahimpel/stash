<script setup lang="ts">
import { Play } from "@lucide/vue";

// The preview of a `<MediaRow>`: 16:9, 120×68 (88×50 on phones), radius 8. With no image it is a
// neutral sunken tile with the site's initial. A video carries a small play mark.
const props = withDefaults(
  defineProps<{
    /** The image (og:image, a video thumbnail). Decorative: the title names the link. */
    src?: string | undefined;
    /** Shown when there is no image: the first letter of the site. */
    initial?: string;
    video?: boolean;
  }>(),
  { initial: "", video: false },
);
</script>

<template>
  <span
    data-slot="media-thumb"
    :data-empty="props.src === undefined ? '' : undefined"
    class="relative flex h-[50px] w-[88px] items-center justify-center overflow-hidden rounded-control bg-sunken text-row-title text-muted-foreground uppercase after:absolute after:inset-0 after:rounded-control after:border after:border-foreground/10 sm:h-[68px] sm:w-[120px]"
  >
    <img
      v-if="props.src !== undefined"
      :src="props.src"
      alt=""
      loading="lazy"
      decoding="async"
      class="size-full object-cover"
    />
    <span v-else aria-hidden="true">{{ props.initial.slice(0, 1) }}</span>
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
