<script setup lang="ts">
import { ArrowUpRight, Bookmark, BookmarkCheck, Copy, Ellipsis } from "@lucide/vue";
import Badge from "@stash/web-ui/badge";
import Button from "@stash/web-ui/button";
import CheckToggle from "@stash/web-ui/check-toggle";
import CompactRow from "@stash/web-ui/compact-row";
import CompactRowThumb from "@stash/web-ui/compact-row-thumb";
import CompactRowTitle from "@stash/web-ui/compact-row-title";
import DropdownMenu from "@stash/web-ui/dropdown-menu";
import DropdownMenuContent from "@stash/web-ui/dropdown-menu-content";
import DropdownMenuItem from "@stash/web-ui/dropdown-menu-item";
import DropdownMenuTrigger from "@stash/web-ui/dropdown-menu-trigger";
import Kbd from "@stash/web-ui/kbd";
import SiteIcon from "@stash/web-ui/site-icon";
import * as SiteTitle from "@stash/web-ui/site-title";
import { computed, useTemplateRef } from "vue";
import { RouterLink } from "vue-router";
import type * as OpenTabsView from "./open-tabs-view.ts";

// An open tab as a compact row: the site's icon, the title on one line (without the site's name),
// then host · how long it has been open · when it was last active (when the device says). Open tabs are scanned, not read, so there is no cover
// and no address line: the whole address is the title's tooltip and what Copy copies. A tab that
// is already in Stash also shows its link's preview and a Saved mark, in the same height.
//
// A click on the row selects it (which shows its actions, as the pointer does); only the title
// opens the tab. While tabs are being picked, the icon is a checkbox and a click picks the row.
const props = defineProps<{
  tab: OpenTabsView.TabRow;
  selected: boolean;
  /** Its actions are out after a swipe to the left. */
  revealed: boolean;
  /** Tabs are being picked for a bulk action. */
  picking: boolean;
  picked: boolean;
  /** Among the tabs of every device (the stale ones): the row names its device. */
  showDevice: boolean;
  /** The tab closed on its device: the row fades out at its place. */
  leaving?: boolean;
}>();
const emit = defineEmits<{
  select: [];
  reveal: [revealed: boolean];
  hold: [];
  pick: [];
  save: [];
  copy: [];
  archive: [];
  close: [];
}>();

const link = useTemplateRef<HTMLAnchorElement>("link");
/** Puts the focus on the title link, so Enter opens the tab. */
const focus = () => link.value?.focus();
defineExpose({ focus });

const title = computed(() =>
  props.tab.title === null ? props.tab.url : SiteTitle.strip(props.tab.title, props.tab.url),
);

const onRowClick = () => (props.picking ? emit("pick") : emit("select"));
// While tabs are picked the title picks its row like the rest of it.
const onTitleClick = (event: MouseEvent) => {
  if (props.picking) event.preventDefault();
};
</script>

<template>
  <CompactRow
    as="li"
    :selected="selected"
    :revealed="revealed"
    :leaving="leaving"
    :data-tab="tab.key"
    :data-saved="tab.saved === null ? undefined : ''"
    v-bind="{ onClick: onRowClick }"
    @update:revealed="(next) => emit('reveal', next)"
    @hold="emit('hold')"
  >
    <template #leading>
      <CheckToggle
        v-if="picking"
        :checked="picked"
        :label="`Select ${title}`"
        @update:checked="emit('pick')"
      />
      <SiteIcon v-else :url="tab.url" />
    </template>
    <template #title>
      <CompactRowTitle as-child>
        <a
          ref="link"
          :href="tab.url"
          target="_blank"
          rel="noopener noreferrer"
          :title="tab.url"
          data-slot="open-tab-title"
          @focus="emit('select')"
          @click="onTitleClick"
          >{{ title }}</a
        >
      </CompactRowTitle>
    </template>
    <template #meta>
      <span data-slot="open-tab-host">{{ tab.host }}</span>
      <span v-if="showDevice" data-shrink="">{{ tab.deviceName }}</span>
      <span v-if="tab.age.label !== null" data-slot="open-tab-age" class="tabular-nums">{{
        tab.age.label
      }}</span>
      <span v-if="tab.active !== null" data-slot="open-tab-active" class="tabular-nums">{{
        tab.active
      }}</span>
    </template>
    <template v-if="tab.saved !== null" #trailing>
      <CompactRowThumb
        v-if="tab.saved.imageUrl !== null"
        :src="tab.saved.imageUrl"
        class="max-sm:hidden"
      />
      <Badge as-child variant="outline">
        <RouterLink
          :to="{ name: 'link-details', params: { id: tab.saved.id } }"
          data-slot="open-tab-saved"
          title="Saved in Stash: open the link"
          v-bind="{ onClick: (event: MouseEvent) => event.stopPropagation() }"
        >
          <BookmarkCheck aria-hidden="true" />Saved
        </RouterLink>
      </Badge>
    </template>
    <template v-if="!picking" #actions>
      <Button v-if="tab.saved === null" as-child variant="ghost" size="sm">
        <button
          type="button"
          data-action="save"
          aria-label="Save to Stash"
          title="Save to Stash"
          @click.stop="emit('save')"
        >
          <Bookmark aria-hidden="true" /><span class="max-sm:hidden">Save</span>
          <Kbd class="max-sm:hidden">S</Kbd>
        </button>
      </Button>
      <Button as-child variant="ghost" size="icon-sm">
        <button
          type="button"
          data-action="copy"
          aria-label="Copy link"
          title="Copy link"
          @click.stop="emit('copy')"
        >
          <Copy aria-hidden="true" />
        </button>
      </Button>
      <Button as-child variant="ghost" size="icon-sm">
        <a
          :href="tab.url"
          target="_blank"
          rel="noopener noreferrer"
          data-action="open"
          aria-label="Open here"
          title="Open here"
          v-bind="{ onClick: (event: MouseEvent) => event.stopPropagation() }"
        >
          <ArrowUpRight aria-hidden="true" />
        </a>
      </Button>
      <!-- The menu's row is the selected one: what the menu says and what a key does can't differ. -->
      <DropdownMenu @update:open="(open: boolean) => open && emit('select')">
        <DropdownMenuTrigger as-child>
          <Button as-child variant="ghost" size="icon-sm">
            <button
              type="button"
              data-action="more"
              aria-label="More actions"
              title="More actions"
              v-bind="{ onClick: (event: MouseEvent) => event.stopPropagation() }"
            >
              <Ellipsis aria-hidden="true" />
            </button>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem data-action="archive" @select="emit('archive')">
            <span class="flex-1">Archive: save and close</span><Kbd>E</Kbd>
          </DropdownMenuItem>
          <DropdownMenuItem data-action="close" @select="emit('close')">
            <span class="flex-1">Close on {{ tab.deviceName }}</span
            ><Kbd>W</Kbd>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </template>
  </CompactRow>
</template>
