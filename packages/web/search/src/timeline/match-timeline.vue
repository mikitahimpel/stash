<script setup lang="ts">
import { computed } from "vue";
import * as MatchTimelineLayout from "./match-timeline-layout.ts";

const props = defineProps<{
  /** Epoch millis; the timeline ends with this month. */
  now: number;
  /** The matches, best first. */
  matches: ReadonlyArray<MatchTimelineLayout.Point>;
  /** Saved links drawn as neutral dots behind the matches. */
  saved: ReadonlyArray<MatchTimelineLayout.Point>;
  /** The id of the match the keyboard is on. */
  selected?: string | undefined;
}>();

const layout = computed(() =>
  MatchTimelineLayout.layout({ now: props.now, matches: props.matches, saved: props.saved }),
);
const label = computed(() => MatchTimelineLayout.describe(layout.value));

// Coordinates: x in percent of the width, y in px. Numbers sit on lanes above the axis.
const axis = 50;
const laneY = (lane: number) => 38 - lane * 13;
const pct = (x: number) => `${(x * 100).toFixed(3)}%`;
</script>

<template>
  <svg
    role="img"
    :aria-label="label"
    width="100%"
    height="74"
    class="block overflow-visible font-mono text-xs"
  >
    <line x1="0" x2="100%" :y1="axis" :y2="axis" class="stroke-hairline" />
    <g v-for="month in layout.months" :key="month.label">
      <line
        :x1="pct(month.x)"
        :x2="pct(month.x)"
        :y1="axis - 6"
        :y2="axis + 6"
        class="stroke-hairline"
      />
      <text :x="pct(month.x)" dx="4" :y="axis + 20" class="fill-muted-foreground">
        {{ month.label }}
      </text>
    </g>
    <circle
      v-for="(x, i) in layout.dots"
      :key="`dot-${i}`"
      :cx="pct(x)"
      :cy="axis"
      r="2"
      class="fill-muted-foreground opacity-50"
    />
    <g
      v-for="match in layout.matches"
      :key="match.id"
      data-testid="timeline-match"
      :data-rank="match.rank"
    >
      <circle
        :cx="pct(match.x)"
        :cy="axis"
        :r="match.id === selected ? 4.5 : 3"
        class="fill-signal"
      />
      <text
        :x="pct(match.x)"
        :y="laneY(match.lane)"
        text-anchor="middle"
        :class="match.id === selected ? 'fill-foreground font-medium' : 'fill-muted-foreground'"
      >
        {{ match.rank }}
      </text>
    </g>
  </svg>
</template>
