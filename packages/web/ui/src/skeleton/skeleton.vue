<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { cn } from "../cn";

/**
 * A placeholder block with the box of what it stands for, so the page doesn't move when the
 * content takes its place. Callers set only the width.
 *
 * - `line`: a line of 13 or 14px text (a 20px line box with a 12px bar in it), `title`: the page
 *   title's line (36px, a 24px bar), `badge`: a `<Badge>` (20px), `prose`: a line of reading
 *   text (16px at 1.6).
 * - `thumb`: the preview of a media row (`<MediaThumb>`), `hero`: a `<MediaHero>`.
 * - `control`: a 36px field or button, `chip`: a 32px chip or `sm` button, `tag`: a `<TagChip>`.
 * - `chart`: the tab age chart with three devices (a lane each and the axis).
 *
 * Rows have their own: `<MediaRowSkeleton>` and `<ListRowSkeleton>`, the real rows with these
 * blocks in their slots.
 */
const props = withDefaults(
  defineProps<{
    shape?:
      | "line"
      | "title"
      | "badge"
      | "prose"
      | "thumb"
      | "hero"
      | "control"
      | "chip"
      | "tag"
      | "chart";
    class?: HTMLAttributes["class"];
  }>(),
  { shape: "line" },
);

// The box takes the layout's place; the bar inside is what shows.
const shapes = {
  line: ["h-5 py-1", "rounded-sm"],
  title: ["h-9 py-1.5", "rounded-sm"],
  badge: ["h-5 w-16", "rounded-sm"],
  prose: ["h-[25.6px] py-1.5", "rounded-sm"],
  thumb: ["h-[62px] w-[110px] sm:h-[90px] sm:w-[160px]", "rounded-control"],
  hero: ["aspect-video max-sm:-mx-4", "rounded-surface max-sm:rounded-none"],
  control: ["h-control-md", "rounded-control"],
  chip: ["h-control-sm w-20", "rounded-control"],
  tag: ["h-6 w-14", "rounded-control"],
  chart: ["h-[152px]", "rounded-control"],
} as const;
</script>

<template>
  <div
    data-slot="skeleton"
    :data-shape="shape"
    aria-hidden="true"
    :class="cn('shrink-0', shapes[shape][0], props.class)"
  >
    <div :class="['size-full animate-pulse bg-hairline', shapes[shape][1]]" />
  </div>
</template>
