<script setup lang="ts">
import * as AtomVue from "@effect/atom-vue";
import type * as Device from "@stash/contracts-domain/device";
import StartSavingCard from "@stash/web-settings/start-saving-card";
import Button from "@stash/web-ui/button";
import EmptyState from "@stash/web-ui/empty-state";
import ErrorState from "@stash/web-ui/error-state";
import Kbd from "@stash/web-ui/kbd";
import PageHeader from "@stash/web-ui/page-header";
import SearchField from "@stash/web-ui/search-field";
import SectionHeader from "@stash/web-ui/section-header";
import Skeleton from "@stash/web-ui/skeleton";
import Toaster from "@stash/web-ui/toaster";
import ToggleChip from "@stash/web-ui/toggle-chip";
import { useDelayedLoading } from "@stash/web-ui/use-delayed-loading";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { computed, nextTick, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import ArchiveAllDialog from "./archive-all-dialog.vue";
import OpenTabRow from "./open-tab-row.vue";
import * as OpenTabsAtoms from "./open-tabs-atoms.ts";
import * as OpenTabsKeys from "./open-tabs-keys.ts";
import * as OpenTabsView from "./open-tabs-view.ts";
import TabAgeChart from "./tab-age-chart.vue";

const registry = AtomVue.injectRegistry();
const view = AtomVue.useAtomValue(() => OpenTabsAtoms.view);
const searched = AtomVue.useAtomValue(() => OpenTabsAtoms.searched);
const shown = AtomVue.useAtomValue(() => OpenTabsAtoms.shown);
const [query, setQuery] = AtomVue.useAtom(() => OpenTabsAtoms.query);
const [device, setDevice] = AtomVue.useAtom(() => OpenTabsAtoms.device);
const toasts = AtomVue.useAtomValue(() => OpenTabsAtoms.toasts);
const archive = AtomVue.useAtomSet(() => OpenTabsAtoms.archive);
const closeOnDevice = AtomVue.useAtomSet(() => OpenTabsAtoms.closeOnDevice);
const listen = AtomVue.useAtomSet(() => OpenTabsKeys.listen);
const retry = () => registry.refresh(OpenTabsAtoms.tabs);

const dismiss = (id: string) => OpenTabsAtoms.dismissToast(registry, id);

const success = <A>(result: AsyncResult.AsyncResult<A, unknown>): A | undefined =>
  AsyncResult.isSuccess(result) ? result.value : undefined;

const all = computed(() => success(view.value));
// The skeleton only shows on a first load that takes a while: the tabs stay cached between visits.
const skeleton = useDelayedLoading(
  () => all.value === undefined && !AsyncResult.isFailure(view.value),
);
const groups = computed(() => success(shown.value) ?? []);
const chips = computed(() =>
  (success(searched.value) ?? []).map((group) => ({
    id: group.device.id,
    name: group.device.name,
    count: group.tabs.length,
  })),
);
const total = computed(() => chips.value.reduce((sum, chip) => sum + chip.count, 0));
const sections = computed(() => OpenTabsView.sections(groups.value));
const rows = computed(() => sections.value.flatMap((section) => section.tabs));
const stale = computed(() => sections.value.find((section) => section.id === "old")?.tabs ?? []);

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
// The counts under the title, once the tabs have loaded.
const subtitle = computed(() =>
  all.value === undefined || all.value.length === 0
    ? {}
    : {
        subtitle: [
          plural(total.value, "tab", "tabs"),
          plural(chips.value.length, "device", "devices"),
          ...(stale.value.length > 0 ? [`${stale.value.length} older than 7 days`] : []),
        ].join(" · "),
      },
);

const pickDevice = (id: Device.DeviceId | null) => setDevice(device.value === id ? null : id);

// The selected row: its `key`, so it stays put while other rows come and go.
const selected = ref<string | null>(null);
const selectedIndex = computed(() => rows.value.findIndex((tab) => tab.key === selected.value));
const selectedTab = computed(() => rows.value[selectedIndex.value]);

const rowRefs = new Map<string, InstanceType<typeof OpenTabRow>>();
const setRowRef = (key: string, row: unknown) => {
  if (row === null) rowRefs.delete(key);
  else rowRefs.set(key, row as InstanceType<typeof OpenTabRow>);
};

/** Selects the tab and puts the focus on its link, so Enter opens it. */
const select = (key: string | undefined) => {
  if (key === undefined) return;
  selected.value = key;
  void nextTick(() => rowRefs.get(key)?.focus());
};

const move = (delta: 1 | -1) => {
  const index = selectedIndex.value;
  const next =
    index === -1
      ? delta === 1
        ? 0
        : rows.value.length - 1
      : Math.min(Math.max(index + delta, 0), rows.value.length - 1);
  select(rows.value[next]?.key);
};

/** Runs `action` on the tab and moves the selection to the row that takes its place. */
const act = (tab: OpenTabsView.TabRow, action: (tab: OpenTabsView.TabRow) => void) => {
  if (tab.key === selected.value) {
    const index = selectedIndex.value;
    const next = rows.value[index + 1] ?? rows.value[index - 1];
    if (next === undefined) selected.value = null;
    else select(next.key);
  }
  action(tab);
};

const confirming = ref(false);
const archiveStale = () => {
  const tabs = stale.value;
  if (tabs.some((tab) => tab.key === selected.value)) selected.value = null;
  for (const tab of tabs) archive(tab);
  confirming.value = false;
};

const run = (command: OpenTabsKeys.Command) => {
  if (command === "up") return move(-1);
  if (command === "down") return move(1);
  const tab = selectedTab.value;
  if (tab === undefined) return;
  act(tab, command === "archive" ? archive : closeOnDevice);
};

// Runs until the page unmounts, which disposes the atom and stops listening.
onMounted(() => listen({ enabled: () => !confirming.value, run }));
</script>

<template>
  <section class="flex flex-col gap-6">
    <PageHeader title="Open now" v-bind="subtitle">
      <!-- The onboarding card offers the same action, one row per kind of device. -->
      <template v-if="all === undefined || all.length > 0" #actions>
        <Button as-child variant="primary" class="max-sm:w-full">
          <RouterLink :to="{ name: 'settings', query: { add: 'device' } }">Add device</RouterLink>
        </Button>
      </template>
    </PageHeader>

    <ErrorState
      v-if="all === undefined && AsyncResult.isFailure(view)"
      title="Couldn't load open tabs"
      @retry="retry"
    />
    <template v-else-if="all === undefined">
      <div v-if="skeleton" data-state="loading" class="flex flex-col gap-4">
        <Skeleton class="h-10 w-full rounded-lg" />
        <div class="flex gap-2">
          <Skeleton v-for="i in 3" :key="i" class="h-[34px] w-20 rounded-[9px]" />
        </div>
        <Skeleton class="h-28 w-full" />
        <div class="flex flex-col">
          <div
            v-for="i in 4"
            :key="i"
            class="flex items-baseline gap-4 border-b border-hairline-row px-3 py-3"
          >
            <Skeleton class="h-4 flex-1" />
            <Skeleton class="h-3 w-24" />
            <Skeleton class="h-3 w-10" />
          </div>
        </div>
      </div>
    </template>
    <StartSavingCard v-else-if="all.length === 0" scenario="tabs" data-state="empty" />
    <template v-else>
      <SearchField
        :model-value="query"
        shortcut="/"
        v-bind="{ placeholder: 'Filter tabs', 'aria-label': 'Filter tabs' }"
        @update:model-value="setQuery"
      />

      <!-- One line on phones: it scrolls on its own, out to the edge of the screen. -->
      <div
        class="flex gap-2 overflow-x-auto [scrollbar-width:none] max-sm:-mr-4 max-sm:pr-4 sm:flex-wrap"
        role="group"
        aria-label="Devices"
      >
        <ToggleChip data-device="all" :pressed="device === null" @update:pressed="pickDevice(null)">
          All <span class="font-mono text-xs text-muted-foreground">{{ total }}</span>
        </ToggleChip>
        <ToggleChip
          v-for="chip in chips"
          :key="chip.id"
          :data-device="chip.id"
          :pressed="device === chip.id"
          @update:pressed="pickDevice(chip.id)"
        >
          {{ chip.name }}
          <span class="font-mono text-xs text-muted-foreground">{{ chip.count }}</span>
        </ToggleChip>
      </div>

      <TabAgeChart v-if="rows.length > 0" :groups="groups" :selected="selected" />

      <EmptyState
        v-if="rows.length === 0"
        data-state="empty"
        :title="query.trim() === '' && total === 0 ? 'No open tabs' : 'No matching tabs'"
        :description="
          query.trim() === '' && total === 0
            ? 'Every device reported an empty window.'
            : 'Nothing open matches this filter.'
        "
      >
        <template v-if="query.trim() !== '' || device !== null" #action>
          <Button as-child>
            <button
              type="button"
              data-action="clear-filter"
              @click="
                setQuery('');
                setDevice(null);
              "
            >
              Clear filter
            </button>
          </Button>
        </template>
      </EmptyState>
      <section
        v-for="section in sections"
        :key="section.id"
        :data-section="section.id"
        class="flex flex-col gap-1"
      >
        <SectionHeader :title="section.title" :count="section.tabs.length">
          <template v-if="section.id === 'old'" #actions>
            <Button as-child size="sm">
              <button type="button" data-action="review" @click="select(section.tabs[0]?.key)">
                Review
              </button>
            </Button>
            <Button as-child size="sm">
              <button type="button" data-action="archive-all" @click="confirming = true">
                Archive all {{ section.tabs.length }}
              </button>
            </Button>
          </template>
        </SectionHeader>
        <ul class="flex flex-col">
          <OpenTabRow
            v-for="tab in section.tabs"
            :key="tab.key"
            :ref="(row) => setRowRef(tab.key, row)"
            :tab="tab"
            :selected="tab.key === selected"
            @select="selected = tab.key"
            @archive="act(tab, archive)"
            @close="act(tab, closeOnDevice)"
          />
        </ul>
      </section>

      <footer
        class="hidden flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground sm:flex"
        aria-label="Shortcuts"
      >
        <span class="flex items-center gap-1.5"><Kbd>↑</Kbd><Kbd>↓</Kbd> select</span>
        <span class="flex items-center gap-1.5"><Kbd>↵</Kbd> open</span>
        <span class="flex items-center gap-1.5"><Kbd>E</Kbd> archive</span>
        <span class="flex items-center gap-1.5"><Kbd>W</Kbd> close on device</span>
        <span class="flex items-center gap-1.5"><Kbd>/</Kbd> filter</span>
      </footer>
    </template>

    <ArchiveAllDialog
      :open="confirming"
      :count="stale.length"
      @confirm="archiveStale"
      @cancel="confirming = false"
    />
    <Toaster :toasts="toasts" @dismiss="dismiss" />
  </section>
</template>
