<script setup lang="ts">
import * as AtomVue from "@effect/atom-vue";
import { Inbox } from "@lucide/vue";
import type * as Link from "@stash/contracts-domain/link";
import type * as Tag from "@stash/contracts-domain/tag";
import SearchBar from "@stash/web-search/search-bar";
import * as SearchAtoms from "@stash/web-search/search-atoms";
import type * as SearchRequest from "@stash/web-search/search-request";
import * as SearchRoute from "@stash/web-search/search-route";
import { useSearchResults } from "@stash/web-search/use-search-results";
import StartSavingCard from "@stash/web-settings/start-saving-card";
import Button from "@stash/web-ui/button";
import EmptyState from "@stash/web-ui/empty-state";
import ErrorState from "@stash/web-ui/error-state";
import Kbd from "@stash/web-ui/kbd";
import GroupHeader from "@stash/web-ui/group-header";
import MediaRow from "@stash/web-ui/media-row";
import MediaRowTitle from "@stash/web-ui/media-row-title";
import MediaThumb from "@stash/web-ui/media-thumb";
import PageHeader from "@stash/web-ui/page-header";
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
import SaveLinkField from "./save-link-field.vue";
import * as SavedRead from "./saved-read.ts";

const registry = AtomVue.injectRegistry();
const route = useRoute();
const router = useRouter();

const filters = computed(() => LinksAtoms.fromQuery(route.query));
const setFilters = (next: LinksAtoms.Filters) =>
  router.replace({ query: LinksAtoms.toQuery(next) });

// A query typed in the header's search field arrives in the URL (`?q=…`), and the list becomes
// its results: the same rows, ranked instead of grouped by day, under a line that says how many
// match and holds the search's menus. Clearing the field brings the feed back.
const search = computed(() => SearchRoute.fromQuery(route.query));
const form = computed<SearchRequest.Form>(() => ({
  ...search.value,
  type: filters.value.type ?? "",
  tag: filters.value.tag ?? "",
}));
const found = useSearchResults(() => form.value);
const searching = found.searching;
const setSearch = (next: SearchRequest.Form) =>
  router.replace({
    query: SearchRoute.withState(
      LinksAtoms.toQuery({
        ...filters.value,
        type: next.type === "" ? undefined : next.type,
        // The line can only clear the tag.
        tag: next.tag === "" ? undefined : filters.value.tag,
      }),
      next,
    ),
  });
/** The list narrowed to `tag`, whether it shows a feed or a search. */
const tagTo = (tag: Tag.TagName) => ({
  name: "links",
  query: SearchRoute.withState(LinksAtoms.toQuery({ ...filters.value, tag }), search.value),
});
const remember = AtomVue.useAtomSet(() => SearchAtoms.remember);
/** Opening a result is acting on the search: it goes to the recent searches. */
const opened = () => {
  if (searching.value) remember(search.value.q);
};

const zone = DateTime.zoneMakeLocal();

const [result, pull] = AtomVue.useAtom(() => LinksAtoms.feed(filters.value));

const feedView = computed(() =>
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

const view = computed(() => {
  if (!searching.value) return feedView.value;
  if (found.failed.value) return { state: "error" as const };
  const hits = found.hits.value;
  if (hits === null) return { state: "loading" as const };
  if (hits.length === 0) return { state: "empty" as const };
  return {
    state: "links" as const,
    links: hits.map((hit) => hit.link),
    done: true,
    waiting: found.waiting.value,
    now: DateTime.nowUnsafe(),
  };
});

// Skeletons only on a first load that takes a while: the feed stays cached between visits.
const loading = useDelayedLoading(() => view.value.state === "loading");
const retry = () =>
  searching.value ? found.retry() : registry.refresh(LinksAtoms.feed(filters.value));

const links = computed(() => (view.value.state === "links" ? view.value.links : []));
const groups = computed(() =>
  view.value.state === "links" ? LinkDays.groupByDay(view.value.links, view.value.now, zone) : [],
);

const recent = AtomVue.useAtomValue(() => SavedRead.recent);
const history = computed(() =>
  AsyncResult.isSuccess(recent.value)
    ? SavedRead.history(recent.value.value.links, recent.value.value.now, zone)
    : undefined,
);

// The counts of the last 30 days, once there is something to count.
const subtitle = computed(() =>
  history.value === undefined || history.value.saved === 0
    ? {}
    : { subtitle: SavedRead.headline(history.value) },
);

const filtered = computed(
  () => filters.value.tag !== undefined || filters.value.type !== undefined,
);

// A new link has no type or tags yet, so a filtered feed won't show it.
const allPending = AtomVue.useAtomValue(() => LinksAtoms.pending);
const pending = computed(() => (filtered.value || searching.value ? [] : allPending.value));
watch([result, allPending], ([now]) => {
  if (!now.waiting && !AsyncResult.isInitial(now)) LinksAtoms.settlePending(registry);
});

// Nothing saved, ever: the page shows how to start instead of an empty list and its filters. An
// empty feed alone doesn't say that, since the links may be seen, archived or old.
const anySaved = AtomVue.useAtomValue(() => LinksAtoms.anySaved);
const firstRun = computed(
  () =>
    view.value.state === "empty" &&
    !searching.value &&
    !filtered.value &&
    AsyncResult.isSuccess(anySaved.value) &&
    !anySaved.value.value &&
    pending.value.length === 0,
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

/** The site of a link that is still being saved, for its placeholder preview. */
const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

const deviceOptions = computed(() =>
  [...deviceNames.value].map(([value, label]) => ({ value, label })),
);

const empty = computed(() =>
  searching.value
    ? { title: "No matches", description: "Try other words, or another mode or filter." }
    : filtered.value
      ? { title: "No matches", description: "No links match these filters." }
      : filters.value.feed === "unseen"
        ? { title: "All caught up", description: "You've seen everything you saved." }
        : { title: "Nothing here", description: "Links you save show up here." },
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
    list.value?.querySelector("[data-state=selected]")?.scrollIntoView?.({ block: "nearest" }),
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
      if (link) opened();
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
    <PageHeader title="Inbox" v-bind="subtitle">
      <template #actions><SaveLinkField /></template>
    </PageHeader>

    <SearchBar
      v-if="searching"
      :form="form"
      :count="found.waiting.value ? undefined : found.hits.value?.length"
      :waiting="found.waiting.value"
      :devices="deviceOptions"
      @change="setSearch"
    />
    <LinksFilters v-else-if="!firstRun" :filters="filters" @change="setFilters" />

    <ul v-if="pending.length > 0" class="flex flex-col">
      <MediaRow v-for="link in pending" :key="link.key" as="li" data-slot="pending-link">
        <template #thumb><MediaThumb :url="link.url" :initial="host(link.url)" /></template>
        <template #title>
          <MediaRowTitle :stretch="false">{{ link.url }}</MediaRowTitle>
        </template>
        <template #meta><span>saving…</span></template>
      </MediaRow>
    </ul>

    <div v-if="view.state === 'loading'" class="flex flex-col gap-3" aria-busy="true">
      <template v-if="loading">
        <Skeleton v-for="n in 3" :key="n" shape="media" />
      </template>
    </div>
    <StartSavingCard v-else-if="firstRun" scenario="links" />
    <EmptyState
      v-else-if="view.state === 'empty' && pending.length === 0 && !AsyncResult.isInitial(anySaved)"
      :title="empty.title"
      :description="empty.description"
    >
      <template #icon><Inbox /></template>
      <template v-if="filtered && !searching" #action>
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
    <ErrorState
      v-else-if="view.state === 'error'"
      :title="searching ? 'Search failed' : 'Couldn\'t load links'"
      @retry="retry"
    />
    <template v-else-if="view.state === 'links'">
      <p v-if="failed" role="alert" class="text-meta text-destructive">
        That didn't work. Try again.
      </p>
      <ul
        v-if="searching"
        ref="list"
        class="flex flex-col"
        aria-label="Results"
        data-slot="search-results"
      >
        <LinkRow
          v-for="link in view.links"
          :key="link.id"
          :link="link"
          :selected="link.id === selectedId"
          :device="deviceName(link)"
          :now="view.now"
          :tag-to="tagTo"
          :highlight="found.highlight.value"
          @select="selectedId = link.id"
          @open="opened"
        />
      </ul>
      <div v-else ref="list" class="flex flex-col gap-8">
        <section
          v-for="group in groups"
          :key="group.key"
          data-slot="link-day"
          class="flex flex-col gap-2"
        >
          <GroupHeader :title="group.label" :count="group.links.length" />
          <ul class="flex flex-col">
            <LinkRow
              v-for="link in group.links"
              :key="link.id"
              :link="link"
              :selected="link.id === selectedId"
              :device="deviceName(link)"
              :now="view.now"
              :tag-to="tagTo"
              @select="selectedId = link.id"
            />
          </ul>
        </section>
      </div>
      <LoadMore v-if="!view.done" :loading="view.waiting" @more="pull()" />
      <p
        class="hidden flex-wrap items-center gap-x-4 gap-y-2 text-meta text-muted-foreground sm:flex"
      >
        <span class="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> select</span>
        <span class="flex items-center gap-1"><Kbd>↵</Kbd> open</span>
        <span class="flex items-center gap-1"><Kbd>S</Kbd> seen</span>
        <span class="flex items-center gap-1"><Kbd>D</Kbd> done</span>
        <span class="flex items-center gap-1"><Kbd>E</Kbd> archive</span>
      </p>
    </template>
  </section>
</template>
