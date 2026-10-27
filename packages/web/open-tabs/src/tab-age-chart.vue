<script setup lang="ts">
import { computed, useId } from "vue";
import * as OpenTabsView from "./open-tabs-view.ts";

const props = defineProps<{
  groups: ReadonlyArray<OpenTabsView.DeviceGroup>;
  /** The `key` of the selected tab, which gets a taller tick and a label. */
  selected: string | null;
}>();

// One lane per device: the device label, then the ticks. Below the lanes, the age axis.
const span = 14;
const lane = 44;
const labelHeight = 16;
const tickTop = 20;
const tick = 16;
const axis = 20;

/** Where a tab of this age sits, in percent of the width. Older than 14 days stays at the end. */
const position = (ms: number) =>
  // Kept a little short of 100% so the 2px tick at the end stays inside the chart.
  Math.min(Math.max(ms, 0) / OpenTabsView.day / span, 1) * 99.6;

const lanes = computed(() =>
  props.groups.map((group, i) => ({
    id: group.device.id,
    name: group.device.name,
    reported: group.reportedAge === null ? "never reported" : group.reportedAge.label,
    y: i * lane,
    ticks: group.tabs.flatMap((tab) =>
      tab.age.ms === null
        ? []
        : [
            {
              key: tab.key,
              x: position(tab.age.ms),
              stale: tab.age.tone === "old",
              selected: tab.key === props.selected,
              label: `${tab.title ?? tab.host} · ${tab.age.label}`,
            },
          ],
    ),
  })),
);

const height = computed(() => Math.max(props.groups.length, 1) * lane + axis);
const stalePercent = (OpenTabsView.oldAfterDays / span) * 100;

const summary = computed(() => {
  const tabs = props.groups.flatMap((group) => group.tabs);
  const stale = tabs.filter((tab) => tab.age.tone === "old").length;
  const unknown = tabs.filter((tab) => tab.age.ms === null).length;
  const devices = props.groups.length;
  return [
    `${tabs.length} ${tabs.length === 1 ? "tab" : "tabs"} on ${devices} ${devices === 1 ? "device" : "devices"}`,
    `${stale} older than ${OpenTabsView.oldAfterDays} days`,
    ...(unknown > 0 ? [`${unknown} of unknown age`] : []),
  ].join(", ");
});

const hatch = `tab-age-hatch-${useId()}`;
</script>

<template>
  <svg
    data-slot="tab-age-chart"
    role="img"
    :aria-label="`Tab age: ${summary}`"
    width="100%"
    :height="height"
    class="block overflow-visible font-mono text-[12px]"
  >
    <defs>
      <pattern
        :id="hatch"
        patternUnits="userSpaceOnUse"
        width="6"
        height="6"
        patternTransform="rotate(45)"
      >
        <line x1="0" y1="0" x2="0" y2="6" class="stroke-hairline" stroke-width="2" />
      </pattern>
    </defs>

    <!-- Past 7 days: hatched, behind a dashed line. -->
    <rect
      data-slot="stale-region"
      :x="`${stalePercent}%`"
      y="0"
      :width="`${100 - stalePercent}%`"
      :height="height - axis"
      :fill="`url(#${hatch})`"
    />
    <line
      :x1="`${stalePercent}%`"
      :x2="`${stalePercent}%`"
      y1="0"
      :y2="height - axis"
      class="stroke-muted-foreground"
      stroke-dasharray="3 3"
    />

    <g v-for="row in lanes" :key="row.id" data-slot="lane" :transform="`translate(0 ${row.y})`">
      <text x="0" :y="labelHeight - 4" class="fill-muted-foreground">
        {{ row.name }} · {{ row.reported }}
      </text>
      <line
        x1="0"
        x2="100%"
        :y1="tickTop + tick"
        :y2="tickTop + tick"
        class="stroke-hairline-row"
      />
      <rect
        v-for="mark in row.ticks"
        :key="mark.key"
        data-slot="tick"
        :data-stale="mark.stale"
        :data-selected="mark.selected"
        :x="`${mark.x}%`"
        :y="mark.selected ? tickTop - 6 : tickTop"
        width="2"
        :height="mark.selected ? tick + 6 : tick"
        :class="
          mark.stale ? 'fill-signal' : mark.selected ? 'fill-foreground' : 'fill-muted-foreground'
        "
      >
        <title>{{ mark.label }}</title>
      </rect>
      <template v-for="mark in row.ticks" :key="`${mark.key}-label`">
        <text
          v-if="mark.selected"
          data-slot="tick-label"
          :x="`${mark.x}%`"
          :y="labelHeight - 4"
          :dx="mark.x > 50 ? -6 : 6"
          :text-anchor="mark.x > 50 ? 'end' : 'start'"
          class="fill-foreground"
        >
          {{ mark.label }}
        </text>
      </template>
    </g>

    <g :transform="`translate(0 ${height - axis + 14})`" class="fill-muted-foreground">
      <text x="0">0d</text>
      <text :x="`${stalePercent}%`" text-anchor="middle">{{ OpenTabsView.oldAfterDays }}d</text>
      <text x="100%" text-anchor="end">{{ span }}d+</text>
    </g>
  </svg>
</template>
