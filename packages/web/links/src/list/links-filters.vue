<script setup lang="ts">
import { X } from "@lucide/vue";
import * as Link from "@stash/contracts-domain/link";
import Badge from "@stash/web-ui/badge";
import Tabs from "@stash/web-ui/tabs";
import TabsList from "@stash/web-ui/tabs-list";
import TabsTrigger from "@stash/web-ui/tabs-trigger";
import * as LinkDisplay from "../link-display.ts";
import * as LinksAtoms from "../links-atoms.ts";

const props = defineProps<{ filters: LinksAtoms.Filters }>();
const emit = defineEmits<{ change: [filters: LinksAtoms.Filters] }>();

const update = (patch: Partial<LinksAtoms.Filters>) =>
  emit("change", { ...props.filters, ...patch });

const onFeed = (value: string | number) => {
  if (value === "recent" || value === "unseen") update({ feed: value });
};

const onType = (event: Event) => {
  const value = (event.target as HTMLSelectElement).value;
  update({ type: Link.LinkType.literals.find((type) => type === value) });
};
</script>

<template>
  <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
    <Tabs :model-value="filters.feed" @update:model-value="onFeed">
      <TabsList>
        <TabsTrigger value="recent">Recent</TabsTrigger>
        <TabsTrigger value="unseen">Not yet seen</TabsTrigger>
      </TabsList>
    </Tabs>
    <div class="flex flex-wrap items-center gap-2">
      <Badge v-if="filters.tag !== undefined" variant="secondary" as-child>
        <button type="button" data-clear="tag" @click="update({ tag: undefined })">
          #{{ filters.tag }}
          <X aria-hidden="true" />
          <span class="sr-only">Clear tag filter</span>
        </button>
      </Badge>
      <label class="flex items-center gap-2 text-sm text-muted-foreground">
        Type
        <select
          name="type"
          class="h-9 rounded-md border border-input bg-transparent px-2 text-sm text-foreground"
          :value="filters.type ?? ''"
          @change="onType"
        >
          <option value="">All</option>
          <option v-for="type in Link.LinkType.literals" :key="type" :value="type">
            {{ LinkDisplay.typeLabels[type] }}
          </option>
        </select>
      </label>
    </div>
  </div>
</template>
