<script setup lang="ts">
import Button from "@stash/web-ui/button";
import Kbd from "@stash/web-ui/kbd";
import MediaRow from "@stash/web-ui/media-row";
import MediaRowTitle from "@stash/web-ui/media-row-title";
import SiteIcon from "@stash/web-ui/site-icon";
import { useTemplateRef } from "vue";
import type * as OpenTabsView from "./open-tabs-view.ts";

// An open tab as a media row, the Inbox's look, but compact: a tab has no preview image, so it
// carries its site's favicon in a small tile (the site's initial when there is none). A click anywhere on the row selects it (which shows its actions); only the title
// opens the tab.
defineProps<{ tab: OpenTabsView.TabRow; selected: boolean }>();
const emit = defineEmits<{ select: []; archive: []; close: [] }>();

const link = useTemplateRef<HTMLAnchorElement>("link");
/** Puts the focus on the title link, so Enter opens the tab. */
const focus = () => link.value?.focus();
defineExpose({ focus });
</script>

<template>
  <MediaRow
    as="li"
    :selected="selected"
    :data-tab="tab.key"
    v-bind="{ onClick: () => emit('select') }"
  >
    <template #thumb><SiteIcon :src="tab.favicon" :initial="tab.host" /></template>
    <template #title>
      <MediaRowTitle as-child :stretch="false">
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
      </MediaRowTitle>
    </template>
    <template #meta>
      <span>{{ tab.host }}</span>
      <span data-shrink="">{{ tab.deviceName }}</span>
      <span
        :data-age="tab.age.tone"
        :title="`Open ${tab.age.label}`"
        :class="['tabular-nums', tab.age.tone === 'old' && 'text-signal']"
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
  </MediaRow>
</template>
