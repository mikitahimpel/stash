<script setup lang="ts">
import * as Link from "@stash/contracts-domain/link";
import FilterMenu from "@stash/web-ui/filter-menu";
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

const types = Link.LinkType.literals.map((value) => ({
  value,
  label: LinkDisplay.typeLabels[value],
}));
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <SegmentedControl
      label="Feed"
      :options="feeds"
      :model-value="filters.feed"
      @update:model-value="(feed) => update({ feed })"
    />
    <div class="flex flex-wrap items-center gap-2" role="group" aria-label="Filters">
      <FilterMenu
        label="Type"
        :options="types"
        :model-value="filters.type ?? ''"
        @update:model-value="(type) => update({ type: type === '' ? undefined : type })"
      />
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
