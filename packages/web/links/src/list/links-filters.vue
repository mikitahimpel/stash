<script setup lang="ts">
import * as Link from "@stash/contracts-domain/link";
import SegmentedControl from "@stash/web-ui/segmented-control";
import type { SegmentedControlOption } from "@stash/web-ui/segmented-control-option";
import ToggleChip from "@stash/web-ui/toggle-chip";
import * as LinkDisplay from "../link-display.ts";
import * as LinksAtoms from "../links-atoms.ts";

const props = defineProps<{ filters: LinksAtoms.Filters }>();
const emit = defineEmits<{ change: [filters: LinksAtoms.Filters] }>();

const update = (patch: Partial<LinksAtoms.Filters>) =>
  emit("change", { ...props.filters, ...patch });

const feeds: ReadonlyArray<SegmentedControlOption<LinksAtoms.Feed>> = [
  { value: "unseen", label: "Not yet seen" },
  { value: "recent", label: "Recent" },
  { value: "all", label: "All" },
];
</script>

<template>
  <div class="flex flex-col gap-3">
    <SegmentedControl
      label="Feed"
      :options="feeds"
      :model-value="filters.feed"
      class="self-start"
      @update:model-value="(feed) => update({ feed })"
    />
    <div class="flex flex-wrap items-center gap-2" role="group" aria-label="Filters">
      <ToggleChip
        v-for="type in Link.LinkType.literals"
        :key="type"
        :pressed="filters.type === type"
        :data-filter-type="type"
        @update:pressed="(on) => update({ type: on ? type : undefined })"
      >
        {{ LinkDisplay.typeLabels[type] }}
      </ToggleChip>
      <ToggleChip
        v-if="filters.tag !== undefined"
        pressed
        data-clear="tag"
        class="font-mono"
        @update:pressed="update({ tag: undefined })"
      >
        #{{ filters.tag }}
        <span class="sr-only">(clear tag filter)</span>
      </ToggleChip>
    </div>
  </div>
</template>
