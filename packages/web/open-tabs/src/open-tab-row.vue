<script setup lang="ts">
import { Archive, ExternalLink, X } from "@lucide/vue";
import Badge from "@stash/web-ui/badge";
import Button from "@stash/web-ui/button";
import type * as OpenTabsView from "./open-tabs-view.ts";

defineProps<{ tab: OpenTabsView.TabRow }>();
const emit = defineEmits<{ archive: []; close: [] }>();

const tones: Record<OpenTabsView.AgeTone, "secondary" | "outline" | "destructive"> = {
  fresh: "secondary",
  aging: "outline",
  old: "destructive",
  unknown: "outline",
};
</script>

<template>
  <li data-slot="open-tab" class="flex items-center gap-3 py-2">
    <a
      :href="tab.url"
      target="_blank"
      rel="noopener noreferrer"
      class="flex min-w-0 flex-1 flex-col hover:underline"
      :title="tab.url"
    >
      <span class="truncate text-sm font-medium">{{ tab.title ?? tab.url }}</span>
      <span class="truncate text-xs text-muted-foreground">{{ tab.url }}</span>
    </a>
    <!-- The kit's components declare no attribute props, so native elements carry them (as-child). -->
    <Badge as-child :variant="tones[tab.age.tone]">
      <span :data-age="tab.age.tone" :title="`Open ${tab.age.label}`">{{ tab.age.label }}</span>
    </Badge>
    <div class="flex shrink-0 gap-1">
      <Button as-child variant="ghost" size="icon">
        <a :href="tab.url" target="_blank" rel="noopener noreferrer" aria-label="Open in a new tab">
          <ExternalLink aria-hidden="true" />
        </a>
      </Button>
      <Button as-child variant="ghost" size="icon">
        <button type="button" aria-label="Archive" data-action="archive" @click="emit('archive')">
          <Archive aria-hidden="true" />
        </button>
      </Button>
      <Button as-child variant="ghost" size="icon">
        <button
          type="button"
          aria-label="Close on device"
          data-action="close"
          @click="emit('close')"
        >
          <X aria-hidden="true" />
        </button>
      </Button>
    </div>
  </li>
</template>
