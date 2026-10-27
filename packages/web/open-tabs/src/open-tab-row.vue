<script setup lang="ts">
import Button from "@stash/web-ui/button";
import Kbd from "@stash/web-ui/kbd";
import ListRow from "@stash/web-ui/list-row";
import TextLink from "@stash/web-ui/text-link";
import { useTemplateRef } from "vue";
import type * as OpenTabsView from "./open-tabs-view.ts";

defineProps<{ tab: OpenTabsView.TabRow; selected: boolean }>();
const emit = defineEmits<{ select: []; archive: []; close: [] }>();

const link = useTemplateRef<HTMLAnchorElement>("link");
/** Puts the focus on the title link, so Enter opens the tab. */
const focus = () => link.value?.focus();
defineExpose({ focus });
</script>

<template>
  <ListRow as="li" :selected="selected" :data-tab="tab.key">
    <!-- A click anywhere on the row selects it (the kit's components take no listeners). -->
    <div
      class="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-4"
      @click="emit('select')"
    >
      <TextLink as-child>
        <a
          ref="link"
          :href="tab.url"
          target="_blank"
          rel="noopener noreferrer"
          :title="tab.url"
          data-slot="open-tab-title"
          class="min-w-0 flex-1 truncate text-[15px]"
          @focus="emit('select')"
          >{{ tab.title ?? tab.url }}</a
        >
      </TextLink>
      <div class="flex min-w-0 items-baseline gap-3 font-mono text-xs text-muted-foreground">
        <span class="min-w-0 truncate sm:max-w-48">{{ tab.host }}</span>
        <span class="shrink-0">{{ tab.deviceName }}</span>
        <span
          :data-age="tab.age.tone"
          :title="`Open ${tab.age.label}`"
          :class="['ml-auto shrink-0 text-right sm:w-12', tab.age.tone === 'old' && 'text-signal']"
          >{{ tab.age.tone === "unknown" ? "—" : tab.age.label }}</span
        >
      </div>
    </div>
    <template #actions>
      <Button as-child size="sm">
        <a :href="tab.url" target="_blank" rel="noopener noreferrer" data-action="open">
          Open here <Kbd>↵</Kbd>
        </a>
      </Button>
      <Button as-child size="sm">
        <button type="button" data-action="archive" @click.stop="emit('archive')">
          Archive <Kbd>E</Kbd>
        </button>
      </Button>
      <Button as-child size="sm">
        <button type="button" data-action="close" @click.stop="emit('close')">
          Close on {{ tab.deviceName }} <Kbd>W</Kbd>
        </button>
      </Button>
    </template>
  </ListRow>
</template>
