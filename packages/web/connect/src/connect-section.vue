<script setup lang="ts">
import { injectRegistry, useAtomValue } from "@effect/atom-vue";
import Button from "@stash/web-ui/button";
import ErrorState from "@stash/web-ui/error-state";
import ListRow from "@stash/web-ui/list-row";
import ListRowTitle from "@stash/web-ui/list-row-title";
import SectionHeader from "@stash/web-ui/section-header";
import ListRowSkeleton from "@stash/web-ui/list-row-skeleton";
import StatusDot from "@stash/web-ui/status-dot";
import { useDelayedLoading } from "@stash/web-ui/use-delayed-loading";
import * as DateTime from "effect/DateTime";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { type Component, computed } from "vue";
import { RouterLink, useRouter } from "vue-router";
import * as ConnectAtoms from "./connect-atoms.ts";
import * as ConnectStatus from "./connect-status.ts";
import ClaudeGuide from "./guides/claude-guide.vue";
import ExtensionGuide from "./guides/extension-guide.vue";
import IphoneGuide from "./guides/iphone-guide.vue";
import MacGuide from "./guides/mac-guide.vue";

// The first section of Settings, "Devices & connections": one row per source (iPhone, Zen, Mac,
// Claude) with its status and a guide that opens in place. The page puts its list of devices in
// the default slot, under the sources.
defineProps<{
  /** The guide open in place (`/settings?guide=iphone`), if any. */
  guide?: ConnectStatus.Source | undefined;
}>();

const sources: ReadonlyArray<{
  readonly id: ConnectStatus.Source;
  readonly title: string;
  readonly what: string;
  readonly guide: Component;
}> = [
  {
    id: "iphone",
    title: "iPhone / iPad",
    what: "Save from the Share sheet",
    guide: IphoneGuide,
  },
  {
    id: "extension",
    title: "Zen",
    what: "Save tabs with a hotkey, see them in Open now",
    guide: ExtensionGuide,
  },
  { id: "mac", title: "Mac", what: "The iPhone's Safari tabs in Open now", guide: MacGuide },
  { id: "claude", title: "Claude", what: "Save and search from a chat", guide: ClaudeGuide },
];

const router = useRouter();
/** The page the section is on, with `guide` open (or none). */
const to = (guide?: ConnectStatus.Source) => ({
  name: "settings",
  query: guide === undefined ? {} : { guide },
});
const close = () => router.push(to());
const registry = injectRegistry();
const snapshot = useAtomValue(() => ConnectAtoms.snapshot);
const loading = useDelayedLoading(() => AsyncResult.isInitial(snapshot.value));
const retry = () => ConnectAtoms.refresh(registry);
const now = computed(() => {
  // Recomputed with each snapshot, so "3m ago" moves while a guide polls.
  void snapshot.value;
  return DateTime.nowUnsafe();
});

const statuses = computed(() => {
  const current = snapshot.value;
  if (!AsyncResult.isSuccess(current)) return undefined;
  return new Map(
    ConnectStatus.sources.map((source) => [source, ConnectStatus.status(source, current.value)]),
  );
});
const count = computed(() => {
  if (statuses.value === undefined) return {};
  const connected = [...statuses.value.values()].filter(
    (status) => status._tag === "Connected",
  ).length;
  return { count: `${connected} of ${sources.length} connected` };
});
</script>

<template>
  <section id="connections" aria-label="Devices & connections" class="flex flex-col gap-1">
    <SectionHeader title="Devices & connections" v-bind="count" />

    <!-- One skeleton row per source, the list's own rows: nothing moves when they load. Before
         the skeleton shows (a fast load never shows it) the rows already hold their place. -->
    <ul
      v-if="loading || AsyncResult.isInitial(snapshot)"
      aria-busy="true"
      :data-state="loading ? 'loading' : undefined"
      :class="loading ? undefined : 'invisible'"
    >
      <ListRowSkeleton v-for="source in sources" :key="source.id" as="li" leading trailing />
    </ul>
    <ErrorState
      v-else-if="AsyncResult.isFailure(snapshot)"
      title="Couldn't load your devices"
      @retry="retry"
    />
    <ul v-else aria-label="Sources">
      <ListRow
        v-for="source in sources"
        :key="source.id"
        as="li"
        :selected="guide === source.id"
        :data-source="source.id"
        :data-status="statuses?.get(source.id)?._tag"
      >
        <template #leading>
          <StatusDot :tone="statuses?.get(source.id)?._tag === 'Connected' ? 'signal' : 'muted'" />
        </template>
        <template #title>
          <ListRowTitle as-child>
            <RouterLink
              :to="guide === source.id ? to() : to(source.id)"
              :aria-expanded="guide === source.id"
              >{{ source.title }}</RouterLink
            >
          </ListRowTitle>
        </template>
        <template #meta>
          <!-- One line, so every row is one height (and the skeleton's): a long status is cut
               on a phone, and whole in its tooltip. -->
          <span
            data-test="status"
            class="max-w-full truncate"
            :title="ConnectStatus.describe(source.id, statuses!.get(source.id)!, now)"
            >{{ ConnectStatus.describe(source.id, statuses!.get(source.id)!, now) }}</span
          >
          <span class="max-sm:hidden">{{ source.what }}</span>
        </template>
        <template v-if="guide !== source.id" #trailing>
          <Button as-child variant="secondary" size="sm">
            <RouterLink :to="to(source.id)" data-action="set-up">
              {{ statuses?.get(source.id)?._tag === "Connected" ? "Add another" : "Set up" }}
            </RouterLink>
          </Button>
        </template>
        <component :is="source.guide" v-if="guide === source.id" />
        <template #actions>
          <Button as-child variant="ghost" size="sm">
            <button type="button" data-action="close" @click="close">Close</button>
          </Button>
        </template>
      </ListRow>
    </ul>
    <slot />
  </section>
</template>
