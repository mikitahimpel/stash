<script setup lang="ts">
import * as AtomVue from "@effect/atom-vue";
import StartSavingCard from "@stash/web-settings/start-saving-card";
import ActionBar from "@stash/web-ui/action-bar";
import Button from "@stash/web-ui/button";
import CompactRowLabel from "@stash/web-ui/compact-row-label";
import * as CompactRowLeave from "@stash/web-ui/compact-row-leave";
import CompactRowSkeleton from "@stash/web-ui/compact-row-skeleton";
import EmptyState from "@stash/web-ui/empty-state";
import ErrorState from "@stash/web-ui/error-state";
import GroupHeader from "@stash/web-ui/group-header";
import Kbd from "@stash/web-ui/kbd";
import PageHeader from "@stash/web-ui/page-header";
import SearchField from "@stash/web-ui/search-field";
import Skeleton from "@stash/web-ui/skeleton";
import Toaster from "@stash/web-ui/toaster";
import { useDelayedLoading } from "@stash/web-ui/use-delayed-loading";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from "vue";
import { RouterLink } from "vue-router";
import ArchiveAllDialog from "./archive-all-dialog.vue";
import * as LiveRows from "./live-rows.ts";
import OpenTabRow from "./open-tab-row.vue";
import * as OpenTabsAtoms from "./open-tabs-atoms.ts";
import * as OpenTabsKeys from "./open-tabs-keys.ts";
import * as OpenTabsView from "./open-tabs-view.ts";

const registry = AtomVue.injectRegistry();
const view = AtomVue.useAtomValue(() => OpenTabsAtoms.view);
const shown = AtomVue.useAtomValue(() => OpenTabsAtoms.sections);
const [query, setQuery] = AtomVue.useAtom(() => OpenTabsAtoms.query);
const [folded, setFolded] = AtomVue.useAtom(() => OpenTabsAtoms.folded);
const toasts = AtomVue.useAtomValue(() => OpenTabsAtoms.toasts);
const hiddenTabs = AtomVue.useAtomValue(() => OpenTabsAtoms.hidden);
const archive = AtomVue.useAtomSet(() => OpenTabsAtoms.archive);
const closeOnDevice = AtomVue.useAtomSet(() => OpenTabsAtoms.closeOnDevice);
const save = AtomVue.useAtomSet(() => OpenTabsAtoms.save);
const copy = AtomVue.useAtomSet(() => OpenTabsAtoms.copy);
const listen = AtomVue.useAtomSet(() => OpenTabsKeys.listen);
const retry = () => registry.refresh(OpenTabsAtoms.tabs);

const dismiss = (id: string) => OpenTabsAtoms.dismissToast(registry, id);
// The one toast with an action is Close on device's, and the action is Undo.
const undo = (id: string) => OpenTabsAtoms.undoClose(registry, id);

const success = <A>(result: AsyncResult.AsyncResult<A, unknown>): A | undefined =>
  AsyncResult.isSuccess(result) ? result.value : undefined;

const all = computed(() => success(view.value));
// The skeleton only shows on a first load that takes a while (the tabs stay cached between
// visits), and then for long enough not to flash. It is the page's own frame: the filter, a
// group's header and its rows.
const skeleton = useDelayedLoading(
  () => all.value === undefined && !AsyncResult.isFailure(view.value),
);
/** How many rows the skeleton has: about a screen of them. */
const skeletonRows = 10;
const sections = computed(() => success(shown.value) ?? []);

// Live changes (#182). A row that left the data (its tab closed on the device) fades out at its place for `leaveMillis`, then the rows under it slide up; a new
// row makes room the same way. A change of the filter is not a change of the tabs: rows just
// show or hide. `drawn` is what the template draws; everything else works on `sections`.
const leaving = ref<ReadonlyArray<LiveRows.Leaving>>([]);
const leavingKeys = computed(() => new Set(leaving.value.map((row) => row.tab.key)));
const drawn = computed(() => LiveRows.withLeaving(sections.value, leaving.value));
const list = useTemplateRef<HTMLElement>("list");
const timers = new Set<ReturnType<typeof setTimeout>>();
let filtering = false;
watch(query, () => (filtering = true), { flush: "sync" });
watch(sections, (now, before) => {
  if (filtering || before === undefined || before.length === 0) {
    filtering = false;
    return;
  }
  // A tab this page archived or closed goes at once: the user saw why.
  const mine = (tab: OpenTabsView.TabRow) =>
    hiddenTabs.value.some((entry) => entry.deviceId === tab.deviceId && entry.url === tab.url);
  const gone = LiveRows.left(before, now).filter(
    (row) => !leavingKeys.value.has(row.tab.key) && !mine(row.tab),
  );
  if (gone.length === 0) return;
  leaving.value = [...leaving.value, ...gone];
  const timer = setTimeout(() => {
    timers.delete(timer);
    const keys = new Set(gone.map((row) => row.tab.key));
    leaving.value = leaving.value.filter((row) => !keys.has(row.tab.key));
  }, CompactRowLeave.leaveMillis);
  timers.add(timer);
});
onBeforeUnmount(() => timers.forEach(clearTimeout));
// Before the rows change on screen, where everything stands; after, the slide from there.
watch(
  drawn,
  () => {
    const root = list.value;
    if (root === null) return;
    const before = LiveRows.measure(root);
    void nextTick(() => LiveRows.slide(root, before));
  },
  { flush: "pre" },
);
const total = computed(() => (all.value ?? []).reduce((sum, group) => sum + group.tabs.length, 0));
const isOpen = (id: string) => !folded.value.has(id);
const setOpen = (id: string, open: boolean) => {
  const next = new Set(folded.value);
  if (open) next.delete(id);
  else next.add(id);
  setFolded(next);
};
/** The rows on screen, in order: what the arrow keys walk. A folded group has none. */
const rows = computed(() =>
  sections.value.flatMap((section) => (isOpen(section.id) ? section.tabs : [])),
);
const stale = computed(
  () => sections.value.find((section) => section.kind === "stale")?.tabs ?? [],
);
const staleUnsaved = computed(() => stale.value.filter((tab) => tab.saved === null));

// The line under the title, once the tabs have loaded. It keeps its place until then.
const subtitle = computed(() => (all.value === undefined ? "" : OpenTabsView.summary(all.value)));

// The selected row: its `key`, so it stays put while other rows come and go.
const selected = ref<string | null>(null);
const selectedIndex = computed(() => rows.value.findIndex((tab) => tab.key === selected.value));
const selectedTab = computed(() => rows.value[selectedIndex.value]);
/** The row whose actions a swipe brought out. One at a time. */
const revealed = ref<string | null>(null);

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
  if (tab.key === revealed.value) revealed.value = null;
  action(tab);
};

// Picking tabs for a bulk action: the keys of the picked rows. `picking` is the mode; it starts
// from the Select button, a held finger or X, and ends with Done or once the picked are saved.
const picking = ref(false);
const picked = ref<ReadonlySet<string>>(new Set());
const pickedTabs = computed(() => rows.value.filter((tab) => picked.value.has(tab.key)));
const toggle = (key: string) => {
  const next = new Set(picked.value);
  if (!next.delete(key)) next.add(key);
  picked.value = next;
};
const pick = (key: string) => {
  picking.value = true;
  revealed.value = null;
  toggle(key);
};
const startPicking = () => {
  picking.value = true;
  revealed.value = null;
};
const stopPicking = () => {
  picking.value = false;
  picked.value = new Set();
};
/** Starts picking with the row a finger was held on. */
const hold = (key: string) => {
  if (picking.value) return;
  picking.value = true;
  revealed.value = null;
  picked.value = new Set([key]);
};
const savePicked = () => {
  save(pickedTabs.value);
  stopPicking();
};
// A picked tab that is gone (archived on another page, filtered out) is no longer picked.
watch(rows, (now) => {
  if (picked.value.size === 0) return;
  const keys = new Set(now.map((tab) => tab.key));
  const kept = [...picked.value].filter((key) => keys.has(key));
  if (kept.length !== picked.value.size) picked.value = new Set(kept);
});

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
  if (command === "pick") return pick(tab.key);
  if (command === "save") return save([tab]);
  if (command === "copy") return copy(tab.url);
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
      <div class="flex items-center gap-2">
        <Skeleton shape="chip" class="w-auto min-w-0 flex-1 sm:w-72 sm:flex-none" />
        <Skeleton shape="chip" class="ml-auto" />
      </div>
      <section class="flex flex-col gap-2">
        <GroupHeader placeholder collapsible />
        <ul class="flex flex-col">
          <CompactRowSkeleton v-for="i in skeletonRows" :key="i" as="li" />
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
      <!-- One line: the filter, and at its end Select or, while tabs are picked, what to do with
           them (a bar at the bottom of the screen on phones). -->
      <div class="flex items-center gap-2" data-slot="open-tabs-toolbar">
        <SearchField
          size="sm"
          class="min-w-0 flex-1 sm:w-72 sm:flex-none"
          :model-value="query"
          v-bind="{ placeholder: 'Filter tabs', 'aria-label': 'Filter tabs' }"
          @update:model-value="setQuery"
        />
        <ActionBar v-if="picking" label="Selected tabs" class="ml-auto">
          <span class="text-meta text-muted-foreground tabular-nums" data-slot="picked-count">
            {{ picked.size }} selected
          </span>
          <Button as-child variant="secondary" size="sm">
            <button
              type="button"
              data-action="save-picked"
              :disabled="pickedTabs.every((tab) => tab.saved !== null)"
              @click="savePicked"
            >
              Save to Stash
            </button>
          </Button>
          <Button as-child variant="ghost" size="sm">
            <button type="button" data-action="done-picking" @click="stopPicking">Done</button>
          </Button>
        </ActionBar>
        <Button v-else-if="rows.length > 0" as-child variant="ghost" size="sm" class="ml-auto">
          <button type="button" data-action="pick" @click="startPicking">Select</button>
        </Button>
      </div>

      <EmptyState
        v-if="sections.length === 0"
        data-state="empty"
        :title="query.trim() === '' && total === 0 ? 'No open tabs' : 'No matching tabs'"
        :description="
          query.trim() === '' && total === 0
            ? 'Every device reported an empty window.'
            : 'Nothing open matches this filter.'
        "
      >
        <template v-if="query.trim() !== ''" #action>
          <Button as-child>
            <button type="button" data-action="clear-filter" @click="setQuery('')">
              Clear filter
            </button>
          </Button>
        </template>
      </EmptyState>
      <!-- Groups of rows sit 32px apart, wider than the page's 24px rhythm. -->
      <div v-else ref="list" class="flex flex-col gap-8">
        <section
          v-for="section in drawn"
          :key="section.id"
          :data-section="section.id"
          :data-kind="section.kind"
          class="flex flex-col gap-2"
        >
          <GroupHeader
            collapsible
            sticky
            :title="section.title"
            :count="section.count"
            :meta="section.note"
            :open="isOpen(section.id)"
            @update:open="(open) => setOpen(section.id, open)"
          >
            <template v-if="section.kind === 'stale'" #actions>
              <Button v-if="staleUnsaved.length > 0" as-child variant="ghost" size="sm">
                <button type="button" data-action="save-stale" @click="save(stale)">
                  Save all
                </button>
              </Button>
              <Button as-child variant="ghost" size="sm">
                <button type="button" data-action="archive-all" @click="confirming = true">
                  Archive all {{ section.tabs.length }}
                </button>
              </Button>
            </template>
          </GroupHeader>
          <ul v-if="isOpen(section.id)" class="flex flex-col">
            <template v-for="(part, index) in section.windows" :key="part.id">
              <!-- A device with several windows (or Zen spaces) labels each one after the first:
                   the first window's rows start under the group's header, where the skeleton's
                   rows are, so nothing moves when the tabs arrive. -->
              <CompactRowLabel
                v-if="index > 0"
                as="li"
                :title="part.title"
                :count="part.count"
                :data-window="part.id"
              />
              <OpenTabRow
                v-for="tab in part.tabs"
                :key="tab.key"
                :ref="(row) => setRowRef(tab.key, row)"
                :tab="tab"
                :leaving="leavingKeys.has(tab.key)"
                :selected="tab.key === selected"
                :revealed="tab.key === revealed"
                :picking="picking"
                :picked="picked.has(tab.key)"
                :show-device="section.kind === 'stale'"
                @select="selected = tab.key"
                @reveal="(out) => (revealed = out ? tab.key : null)"
                @hold="hold(tab.key)"
                @pick="pick(tab.key)"
                @save="save([tab])"
                @copy="copy(tab.url)"
                @archive="act(tab, archive)"
                @close="act(tab, closeOnDevice)"
              />
            </template>
          </ul>
        </section>
      </div>

      <footer
        class="hidden flex-wrap gap-x-4 gap-y-2 text-meta text-muted-foreground sm:flex"
        aria-label="Shortcuts"
      >
        <span class="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> select</span>
        <span class="flex items-center gap-1"><Kbd>↵</Kbd> open</span>
        <span class="flex items-center gap-1"><Kbd>S</Kbd> save</span>
        <span class="flex items-center gap-1"><Kbd>C</Kbd> copy link</span>
        <span class="flex items-center gap-1"><Kbd>X</Kbd> pick</span>
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
    <Toaster :toasts="toasts" @dismiss="dismiss" @action="undo" />
  </section>
</template>
