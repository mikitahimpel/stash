<script setup lang="ts">
import { Play } from "@lucide/vue";
import { computed, ref, watch } from "vue";
import MediaFit from "../media-fit/media-fit.vue";
import * as PostMedia from "./post-media";

// A post's video or GIF in its box: the poster (lazy, no referrer) with a play button, and after a
// press the player in its place. Nothing of the video loads before that press. The player is a
// frame whose document loads everything without a referrer (see `PostMedia.playerDocument`). The
// frame is sandboxed without `allow-same-origin`: a `srcdoc` document would otherwise have this
// page's origin, and its markup is built from a post's URLs. With an opaque origin it cannot reach
// the app whatever it contains. `allow-scripts` is there only because a sandbox without it also
// blocks `autoplay`; the document has no script. A video with no playable file is its poster alone.
//
// The poster and the player share one frame (`<MediaFit>`, #176): a video of another shape than
// its box (a portrait one, alone in a post) is a centred player of its own shape over the blurred
// poster, with the play button in the middle. Fullscreen is the player's own, at the video's size.
const props = withDefaults(
  defineProps<{
    video: PostMedia.Video;
    label?: string | undefined;
    /** How the video sits in its box: see `<MediaFit>`. A cell of a grid is `cover`. */
    fit?: "auto" | "contain" | "cover";
  }>(),
  { label: undefined, fit: "auto" },
);

const playing = ref(false);
watch(
  () => props.video.videoUrl,
  () => (playing.value = false),
);
const failed = ref(false);
const player = computed(() => (playing.value ? PostMedia.playerDocument(props.video) : undefined));
const name = computed(() => props.label ?? (props.video.kind === "gif" ? "GIF" : "video"));
</script>

<template>
  <div
    data-slot="post-video"
    :data-playing="player === undefined ? undefined : ''"
    class="relative flex size-full items-center justify-center overflow-hidden bg-black"
  >
    <MediaFit
      v-if="player !== undefined || !failed"
      :src="failed ? undefined : video.posterUrl"
      :aspect="PostMedia.ratio(video)"
      :fit="fit"
      @error="failed = true"
    >
      <iframe
        v-if="player !== undefined"
        data-slot="post-video-player"
        :srcdoc="player"
        :title="`Playing ${name}`"
        sandbox="allow-scripts"
        allow="autoplay; fullscreen; picture-in-picture"
        allowfullscreen
        referrerpolicy="no-referrer"
        class="absolute inset-0 size-full border-0"
      />
    </MediaFit>
    <template v-if="player === undefined">
      <button
        v-if="video.videoUrl !== null"
        type="button"
        data-slot="post-video-play"
        :aria-label="`Play ${name}`"
        class="relative hit-area flex h-control-lg w-16 shrink-0 cursor-pointer items-center justify-center rounded-control bg-black/70 text-white transition-colors outline-none hover:bg-black/85 focus-visible:ring-2 focus-visible:ring-white/70"
        @click="playing = true"
      >
        <Play aria-hidden="true" class="size-5 fill-current" />
      </button>
      <span
        v-if="video.kind === 'gif'"
        data-slot="post-video-gif"
        aria-hidden="true"
        class="absolute bottom-2 left-2 rounded-sm bg-black/70 px-1.5 text-[11px]/5 font-medium text-white"
        >GIF</span
      >
    </template>
  </div>
</template>
