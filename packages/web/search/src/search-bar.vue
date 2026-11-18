<script setup lang="ts">
import type * as SearchGroup from "@stash/contracts-api/search";
import type * as Link from "@stash/contracts-domain/link";
import FilterMenu from "@stash/web-ui/filter-menu";
import ScrollRow from "@stash/web-ui/scroll-row";
import type { SegmentedControlOption } from "@stash/web-ui/segmented-control-option";
import ToggleChip from "@stash/web-ui/toggle-chip";
import { computed } from "vue";
import * as SearchRequest from "./search-request.ts";

// The line over the results of a search, where the Inbox has its feed switch: how many links
// match which query, the mode as a menu (`Hybrid ▾`), and the Type, Device and Date menus inline.
// On a phone the menus are one line under the summary that scrolls sideways and never wraps.
const props = defineProps<{
  form: SearchRequest.Form;
  /** How many links match, or `undefined` until the first answer. */
  count: number | undefined;
  /** The next answer is on its way. */
  waiting: boolean;
  devices: ReadonlyArray<SegmentedControlOption<string>>;
}>();
const emit = defineEmits<{ change: [form: SearchRequest.Form] }>();

const update = (patch: Partial<SearchRequest.Form>) => emit("change", { ...props.form, ...patch });

const types = SearchRequest.types.map((value) => ({
  value,
  label: SearchRequest.typeLabels[value],
}));

const summary = computed(() => {
  const query = props.form.q.trim();
  if (props.count === undefined) return `Searching for “${query}”`;
  return `${props.count} ${props.count === 1 ? "result" : "results"} for “${query}”`;
});
</script>

<template>
  <div
    class="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center"
    data-slot="search-bar"
    :aria-busy="waiting || undefined"
  >
    <div class="flex min-w-0 items-center gap-2">
      <p class="flex min-w-0 items-center gap-2 text-body text-muted-foreground">
        <span class="truncate" data-slot="search-summary" role="status">{{ summary }}</span>
        <span aria-hidden="true">·</span>
      </p>
      <FilterMenu
        plain
        label="Search mode"
        :options="SearchRequest.modes"
        :model-value="form.mode"
        @update:model-value="(mode) => update({ mode: mode === '' ? 'hybrid' : mode })"
      />
    </div>
    <ScrollRow class="sm:ml-auto" v-bind="{ role: 'group', 'aria-label': 'Filters' }">
      <FilterMenu
        label="Type"
        :options="types"
        :model-value="form.type"
        @update:model-value="(type: Link.LinkType | '') => update({ type })"
      />
      <FilterMenu
        v-if="devices.length > 0"
        label="Device"
        :options="devices"
        :model-value="form.device"
        @update:model-value="(device) => update({ device })"
      />
      <FilterMenu
        label="Date"
        :options="SearchRequest.ranges"
        :model-value="form.range"
        @update:model-value="(range: SearchRequest.Range | '') => update({ range })"
      />
      <ToggleChip
        v-if="form.tag !== ''"
        pressed
        data-clear="tag"
        @update:pressed="update({ tag: '' })"
      >
        #{{ form.tag }}
        <span class="sr-only">(clear tag filter)</span>
      </ToggleChip>
    </ScrollRow>
  </div>
</template>
