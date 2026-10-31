<script setup lang="ts">
import { computed } from "vue";
import * as SavedRead from "./saved-read.ts";

const props = defineProps<{ history: SavedRead.History }>();

// One bar per day in a 10-unit slot, scaled to the busiest day. The SVG stretches to the width.
const slot = 10;
const height = 48;
const width = SavedRead.days * slot;

const bars = computed(() => {
  const max = Math.max(1, ...props.history.days.map((day) => day.saved));
  const scale = (count: number) => (count / max) * height;
  const last = props.history.days.length - 1;
  return props.history.days.map((day, index) => {
    const x = index * slot + 1;
    const read = scale(day.read);
    // Today's unread links stand out; on other days the rest of the bar stays neutral.
    const unread = index === last ? scale(day.unread) : 0;
    const rest = scale(day.saved) - read - unread;
    return {
      key: day.key,
      x,
      read: { y: height - read, height: read },
      rest: { y: height - read - rest, height: rest },
      unread: { y: height - read - rest - unread, height: unread },
    };
  });
});

// The chart carries the counts only in its label: the page subtitle shows them.
const summary = computed(() => SavedRead.summary(props.history));
</script>

<template>
  <figure data-slot="saved-read-chart" class="flex flex-col gap-2">
    <svg
      role="img"
      :aria-label="`${summary}. One bar per day, oldest first.`"
      :viewBox="`0 0 ${width} ${height}`"
      preserveAspectRatio="none"
      class="h-12 w-full"
    >
      <line
        x1="0"
        :y1="height"
        :x2="width"
        :y2="height"
        class="stroke-hairline"
        vector-effect="non-scaling-stroke"
      />
      <g v-for="bar in bars" :key="bar.key">
        <rect
          :x="bar.x"
          :y="bar.rest.y"
          :width="slot - 2"
          :height="bar.rest.height"
          class="fill-muted-foreground"
        />
        <rect
          :x="bar.x"
          :y="bar.read.y"
          :width="slot - 2"
          :height="bar.read.height"
          class="fill-muted-foreground opacity-35"
        />
        <rect
          v-if="bar.unread.height > 0"
          :x="bar.x"
          :y="bar.unread.y"
          :width="slot - 2"
          :height="bar.unread.height"
          class="fill-signal opacity-45"
          data-slot="saved-read-today-unread"
        />
      </g>
    </svg>
    <figcaption class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span class="flex items-center gap-3" aria-hidden="true">
        <span class="flex items-center gap-1.5">
          <svg viewBox="0 0 8 8" class="size-2">
            <rect width="8" height="8" class="fill-muted-foreground opacity-35" />
          </svg>
          read
        </span>
        <span class="flex items-center gap-1.5">
          <svg viewBox="0 0 8 8" class="size-2">
            <rect width="8" height="8" class="fill-muted-foreground" />
          </svg>
          unread
        </span>
        <span class="flex items-center gap-1.5">
          <svg viewBox="0 0 8 8" class="size-2">
            <rect width="8" height="8" class="fill-signal opacity-45" />
          </svg>
          unread today
        </span>
      </span>
    </figcaption>
  </figure>
</template>
