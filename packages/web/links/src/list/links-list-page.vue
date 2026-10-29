<script setup lang="ts">
import * as AtomVue from "@effect/atom-vue";
import { Inbox } from "@lucide/vue";
import type * as Link from "@stash/contracts-domain/link";
import Button from "@stash/web-ui/button";
import EmptyState from "@stash/web-ui/empty-state";
import ErrorState from "@stash/web-ui/error-state";
import Kbd from "@stash/web-ui/kbd";
import PageHeader from "@stash/web-ui/page-header";
import SectionHeader from "@stash/web-ui/section-header";
import Skeleton from "@stash/web-ui/skeleton";
import { useDelayedLoading } from "@stash/web-ui/use-delayed-loading";
import * as DateTime from "effect/DateTime";
import * as Exit from "effect/Exit";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { computed, nextTick, onMounted, ref, useTemplateRef, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import * as LinksAtoms from "../links-atoms.ts";
import * as InboxShortcuts from "./inbox-shortcuts.ts";
import * as LinkDays from "./link-days.ts";
import LinkRow from "./link-row.vue";
import LinksFilters from "./links-filters.vue";
import LoadMore from "./load-more.vue";
import SavedReadChart from "./saved-read-chart.vue";
import * as SavedRead from "./saved-read.ts";

const registry = AtomVue.injectRegistry();
const route = useRoute();
const router = useRouter();

const filters = computed(() => LinksAtoms.fromQuery(route.query));
const setFilters = (next: LinksAtoms.Filters) =>
  router.replace({ query: LinksAtoms.toQuery(next) });

const zone = DateTime.zoneMakeLocal();

const [result, pull] = AtomVue.useAtom(() => LinksAtoms.feed(filters.value));

const view = computed(() =>
  AsyncResult.match(result.value, {
    onInitial: () => ({ state: "loading" as const }),
    onFailure: (failure) =>
      // An empty feed fails with NoSuchElementError.
      failure.cause.reasons.some(
        (reason) => reason._tag === "Fail" && reason.error._tag === "NoSuchElementError",
      )
        ? { state: "empty" as const }
        : { state: "error" as const },
    onSuccess: ({ value, waiting }) => {
      const links = value.items.filter((link) => LinksAtoms.shows(filters.value, link));
      return links.length === 0 && value.done
        ? { state: "empty" as const }
        : { state: "links" as const, links, done: value.done, waiting, now: DateTime.nowUnsafe() };
    },
  }),
);

// Skeletons only on a first load that takes a while: the feed stays cached between visits.
const loading = useDelayedLoading(() => view.value.state === "loading");
const retry = () => registry.refresh(LinksAtoms.feed(filters.value));

const links = computed(() => (view.value.state === "links" ? view.value.links : []));
const groups = computed(() =>
  view.value.state === "links" ? LinkDays.groupByDay(view.value.links, view.value.now, zone) : [],
);

const recent = AtomVue.useAtomValue(() => SavedRead.recent);
const chartLoading = useDelayedLoading(() => AsyncResult.isInitial(recent.value));
const history = computed(() =>
  AsyncResult.isSuccess(recent.value)
    ? SavedRead.history(recent.value.value.links, recent.value.value.now, zone)
    : undefined,
);

// The unread count under the title, once the 30-day history has loaded. The chart below has the
// rest.
const subtitle = computed(() =>
  history.value === undefined ? {} : { subtitle: `${history.value.unread} unread` },
);

const devices = AtomVue.useAtomValue(() => LinksAtoms.devices);
const deviceNames = computed(
  () =>
    new Map(
      AsyncResult.isSuccess(devices.value)
        ? devices.value.value.map((device) => [device.id as string, device.name])
        : [],
    ),
);
const deviceName = (link: Link.Link) =>
  link.sourceDeviceId === null ? undefined : deviceNames.value.get(link.sourceDeviceId);

const emptyText = computed(() =>
  filters.value.tag !== undefined || filters.value.type !== undefined
    ? "No links match these filters."
    : filters.value.feed === "unseen"
      ? "You've seen everything you saved."
      : "Links you save show up here.",
);

// The row the keyboard is on, by id, so it stays put while the feed reloads around it.
const selectedId = ref<Link.LinkId | undefined>(undefined);
watch(filters, () => (selectedId.value = undefined));
const selectedIndex = computed(() => links.value.findIndex((link) => link.id === selectedId.value));
// A row that left the feed (marked seen on Not yet seen) passes the selection to the next one.
let lastIndex = -1;
watch(links, (now) => {
  if (selectedId.value === undefined || selectedIndex.value !== -1) return;
  selectedId.value = now[Math.min(lastIndex, now.length - 1)]?.id;
});
watch(selectedIndex, (index) => {
  if (index !== -1) lastIndex = index;
});

const list = useTemplateRef<HTMLElement>("list");
const select = (index: number) => {
  const link = links.value[index];
  if (link === undefined) return;
  selectedId.value = link.id;
  // The last row loads the next page, as scrolling to it would.
  if (index === links.value.length - 1 && view.value.state === "links" && !view.value.done) pull();
  void nextTick(() =>
    list.value
      ?.querySelector("[data-slot=list-row][data-state=selected]")
      ?.scrollIntoView?.({ block: "nearest" }),
  );
};

const setStatus = AtomVue.useAtomSet(() => LinksAtoms.setStatus, { mode: "promiseExit" });
const failed = ref(false);
const changeStatus = async (link: Link.Link, status: Link.LinkStatus) => {
  // The same changes the row's action bar offers.
  const applies = status === "seen" ? link.status === "new" : link.status !== status;
  if (!applies) return;
  failed.value = Exit.isFailure(await setStatus({ id: link.id, status }));
};

const run = (command: InboxShortcuts.Command) => {
  const index = selectedIndex.value;
  const link = links.value[index];
  switch (command) {
    case "next":
      return select(index + 1);
    case "previous":
      return select(index === -1 ? 0 : Math.max(0, index - 1));
    case "open":
      return link && router.push({ name: "link-details", params: { id: link.id } });
    case "seen":
      return link && changeStatus(link, "seen");
    case "done":
      return link && changeStatus(link, "done");
    case "archive":
      return link && changeStatus(link, "archived");
  }
};

const listen = AtomVue.useAtomSet(() => InboxShortcuts.listen);
// Runs until the page unmounts, which disposes the atom and stops listening.
onMounted(() => listen({ run }));
</script>

<template>
  <section class="flex flex-col gap-6">
    <PageHeader title="Inbox" v-bind="subtitle" />
    <SavedReadChart v-if="history !== undefined" :history="history" />
    <Skeleton v-else-if="chartLoading" class="h-[72px]" />

    <LinksFilters :filters="filters" @change="setFilters" />

    <div v-if="view.state === 'loading'" class="flex flex-col gap-3" aria-busy="true">
      <template v-if="loading">
        <Skeleton v-for="n in 3" :key="n" class="h-16" />
      </template>
    </div>
    <EmptyState v-else-if="view.state === 'empty'" title="Nothing here" :description="emptyText">
      <template #icon><Inbox /></template>
      <template v-if="filters.tag !== undefined || filters.type !== undefined" #action>
        <Button as-child>
          <button
            type="button"
            data-action="clear-filters"
            @click="setFilters({ ...filters, tag: undefined, type: undefined })"
          >
            Clear filters
          </button>
        </Button>
      </template>
    </EmptyState>
    <ErrorState v-else-if="view.state === 'error'" title="Couldn't load links" @retry="retry" />
    <template v-else>
      <p v-if="failed" role="alert" class="text-[13px] text-destructive">
        That didn't work. Try again.
      </p>
      <div ref="list" class="flex flex-col gap-6">
        <section v-for="group in groups" :key="group.key" data-slot="link-day">
          <SectionHeader :title="group.label" :count="group.links.length" class="px-3" />
          <ul class="flex flex-col">
            <LinkRow
              v-for="link in group.links"
              :key="link.id"
              :link="link"
              :selected="link.id === selectedId"
              :device="deviceName(link)"
              :now="view.now"
              @select="selectedId = link.id"
              @tag="(tag) => setFilters({ ...filters, tag })"
              @type="(type) => setFilters({ ...filters, type })"
            />
          </ul>
        </section>
      </div>
      <LoadMore v-if="!view.done" :loading="view.waiting" @more="pull()" />
      <p
        class="hidden flex-wrap items-center gap-x-3 gap-y-2 font-mono text-xs text-muted-foreground sm:flex"
      >
        <span><Kbd>↑</Kbd> <Kbd>↓</Kbd> select</span>
        <span><Kbd>↵</Kbd> open</span>
        <span><Kbd>S</Kbd> seen</span>
        <span><Kbd>D</Kbd> done</span>
        <span><Kbd>E</Kbd> archive</span>
      </p>
    </template>
  </section>
</template>
