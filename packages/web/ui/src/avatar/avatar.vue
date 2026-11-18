<script setup lang="ts">
import { computed, ref, watch } from "vue";

// A person's picture: round, in one of four sizes (16 in a row's meta line, 24 in a quoted post,
// 40 in a post's header, 48 on a row's generated cover). The image is remote: it loads lazily and
// without a referrer. With no image, or one that fails to load, the name's initial takes its
// place.
const props = withDefaults(
  defineProps<{
    /** The image. Decorative: the name stands beside it. */
    src?: string | null | undefined;
    /** Whose picture it is: the initial comes from it. */
    name?: string | undefined;
    size?: "xs" | "sm" | "md" | "lg";
  }>(),
  { src: undefined, name: undefined, size: "md" },
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
const initial = computed(() => Array.from((props.name ?? "").trim())[0] ?? "");

const sizes = {
  xs: "size-4 text-[9px]/4",
  sm: "size-6 text-[11px]/6",
  md: "size-10 text-label",
  lg: "size-9 text-label sm:size-12",
} as const;
</script>

<template>
  <span
    data-slot="avatar"
    :data-empty="image === undefined ? '' : undefined"
    :class="[
      'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-hairline font-medium text-muted-foreground uppercase after:absolute after:inset-0 after:rounded-full after:border after:border-foreground/10',
      sizes[size],
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
    <span v-else aria-hidden="true">{{ initial }}</span>
  </span>
</template>
