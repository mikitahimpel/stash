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
import GroupHeader from "@stash/web-ui/group-header";
import MediaRowSkeleton from "@stash/web-ui/media-row-skeleton";
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
// The skeleton only shows on a first load that takes a while (the tabs stay cached between
// visits), and then for long enough not to flash. It is the page's own frame: the field, the
// chips, the chart and the list's rows.
const skeleton = useDelayedLoading(
  () => all.value === undefined && !AsyncResult.isFailure(view.value),
);
/** How many rows the skeleton has: about a screen of them. */
const skeletonRows = 5;
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
// The counts under the title, once the tabs have loaded. The line keeps its place until then.
const subtitle = computed(() =>
  all.value === undefined || all.value.length === 0
    ? ""
    : [
        plural(total.value, "tab", "tabs"),
        plural(chips.value.length, "device", "devices"),
        ...(stale.value.length > 0 ? [`${stale.value.length} older than 7 days`] : []),
      ].join(" · "),
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
    <PageHeader title="Open now" :subtitle="subtitle">
      <!-- In every state of the page, so the header never changes (on phones the button has a
           line of its own). The onboarding card offers the same action per kind of device. -->
      <template #actions>
        <Button as-child variant="primary" class="max-sm:w-full">
          <RouterLink :to="{ name: 'settings', hash: '#connections' }">Add device</RouterLink>
        </Button>
      </template>
    </PageHeader>

    <div v-if="skeleton" data-state="loading" class="flex flex-col gap-6" aria-busy="true">
      <Skeleton shape="control" />
      <div class="flex gap-2">
        <Skeleton v-for="i in 3" :key="i" shape="chip" />
      </div>
      <Skeleton shape="chart" />
      <section class="flex flex-col gap-2">
        <GroupHeader placeholder />
        <ul class="flex flex-col">
          <MediaRowSkeleton v-for="i in skeletonRows" :key="i" as="li" />
        </ul>
      </section>
    </div>
    <ErrorState
      v-else-if="all === undefined && AsyncResult.isFailure(view)"
      title="Couldn't load open tabs"
      @retry="retry"
    />
    <div v-else-if="all === undefined" aria-busy="true" />
    <StartSavingCard v-else-if="all.length === 0" scenario="tabs" data-state="empty" />
    <template v-else>
      <SearchField
        :model-value="query"
        v-bind="{ placeholder: 'Filter tabs', 'aria-label': 'Filter tabs' }"
        @update:model-value="setQuery"
      />

      <!-- One line on phones: it scrolls on its own. -->
      <div
        class="flex gap-2 overflow-x-auto [scrollbar-width:none] sm:flex-wrap"
        role="group"
        aria-label="Devices"
      >
        <ToggleChip data-device="all" :pressed="device === null" @update:pressed="pickDevice(null)">
          All <span class="text-muted-foreground tabular-nums">{{ total }}</span>
        </ToggleChip>
        <ToggleChip
          v-for="chip in chips"
          :key="chip.id"
          :data-device="chip.id"
          :pressed="device === chip.id"
          @update:pressed="pickDevice(chip.id)"
        >
          {{ chip.name }}
          <span class="text-muted-foreground tabular-nums">{{ chip.count }}</span>
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
      <!-- Groups of rows sit 32px apart, wider than the page's 24px rhythm. -->
      <div v-if="sections.length > 0" class="flex flex-col gap-8">
        <section
          v-for="section in sections"
          :key="section.id"
          :data-section="section.id"
          class="flex flex-col gap-2"
        >
          <GroupHeader :title="section.title" :count="section.tabs.length">
            <template v-if="section.id === 'old'" #actions>
              <Button as-child variant="ghost" size="sm">
                <button type="button" data-action="review" @click="select(section.tabs[0]?.key)">
                  Review
                </button>
              </Button>
              <Button as-child variant="ghost" size="sm">
                <button type="button" data-action="archive-all" @click="confirming = true">
                  Archive all {{ section.tabs.length }}
                </button>
              </Button>
            </template>
          </GroupHeader>
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
      </div>

      <footer
        class="hidden flex-wrap gap-x-4 gap-y-2 text-meta text-muted-foreground sm:flex"
        aria-label="Shortcuts"
      >
        <span class="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> select</span>
        <span class="flex items-center gap-1"><Kbd>↵</Kbd> open</span>
        <span class="flex items-center gap-1"><Kbd>E</Kbd> archive</span>
        <span class="flex items-center gap-1"><Kbd>W</Kbd> close on device</span>
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
