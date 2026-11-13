<script setup lang="ts">
import Button from "@stash/web-ui/button";
import Kbd from "@stash/web-ui/kbd";
import ListRow from "@stash/web-ui/list-row";
import ListRowTitle from "@stash/web-ui/list-row-title";
import { useTemplateRef } from "vue";
import type * as OpenTabsView from "./open-tabs-view.ts";

defineProps<{ tab: OpenTabsView.TabRow; selected: boolean }>();
const emit = defineEmits<{ select: []; archive: []; close: [] }>();

const link = useTemplateRef<HTMLAnchorElement>("link");
/** Puts the focus on the title link, so Enter opens the tab. */
const focus = () => link.value?.focus();
defineExpose({ focus });

// A click anywhere on the row selects it.
</script>

<template>
  <ListRow
    as="li"
    :selected="selected"
    :data-tab="tab.key"
    v-bind="{ onClick: () => emit('select') }"
  >
    <template #title>
      <ListRowTitle as-child>
        <a
          ref="link"
          :href="tab.url"
          target="_blank"
          rel="noopener noreferrer"
          :title="tab.url"
          data-slot="open-tab-title"
          @focus="emit('select')"
          >{{ tab.title ?? tab.url }}</a
        >
      </ListRowTitle>
    </template>
    <template #meta>
      <span class="min-w-0 truncate sm:max-w-48">{{ tab.host }}</span>
      <span class="shrink-0">{{ tab.deviceName }}</span>
      <span
        :data-age="tab.age.tone"
        :title="`Open ${tab.age.label}`"
        :class="[
          'shrink-0 tabular-nums sm:w-12 sm:text-right',
          tab.age.tone === 'old' && 'text-signal',
        ]"
        >{{ tab.age.tone === "unknown" ? "—" : tab.age.label }}</span
      >
    </template>
    <template #actions>
      <Button as-child variant="ghost" size="sm">
        <a :href="tab.url" target="_blank" rel="noopener noreferrer" data-action="open">
          Open here <Kbd>↵</Kbd>
        </a>
      </Button>
      <Button as-child variant="ghost" size="sm">
        <button type="button" data-action="archive" @click.stop="emit('archive')">
          Archive <Kbd>E</Kbd>
        </button>
      </Button>
      <Button as-child variant="ghost" size="sm">
        <button type="button" data-action="close" @click.stop="emit('close')">
          Close on {{ tab.deviceName }} <Kbd>W</Kbd>
        </button>
      </Button>
    </template>
  </ListRow>
</template>
