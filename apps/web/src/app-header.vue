<script setup lang="ts">
import { useAtomSet, useAtomValue } from "@effect/atom-vue";
import { Monitor, Moon, Search, Sun } from "@lucide/vue";
import LogoutButton from "@stash/web-auth/logout-button";
import * as Theme from "@stash/web-platform/theme";
import Button from "@stash/web-ui/button";
import Kbd from "@stash/web-ui/kbd";
import {
  segmentedControlItemVariants,
  segmentedControlVariants,
} from "@stash/web-ui/segmented-control-variants";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { computed, nextTick, onMounted } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import * as AppNetwork from "./app-network.ts";
import * as AppShortcuts from "./app-shortcuts.ts";
import * as ThemeAtoms from "@stash/web-settings/theme-atoms";

const route = useRoute();
const router = useRouter();

const nav = [
  { name: "links", label: "Inbox" },
  { name: "open-tabs", label: "Open now" },
  { name: "search", label: "Search" },
  { name: "settings", label: "Settings" },
] as const;

// The section of the current page. Pages below a section (`/links/:id`) keep it marked.
const current = computed(() =>
  nav.find((item) => {
    const path = router.resolve({ name: item.name }).path;
    return route.path === path || route.path.startsWith(`${path}/`);
  }),
);

// Resolves once the search page is on screen, so its field can take the focus.
const openSearch = () => router.push({ name: "search" }).then(() => nextTick());
const focusPageSearch = useAtomSet(() => AppShortcuts.focusPageSearch);
const listen = useAtomSet(() => AppShortcuts.listen);
// Runs until the header unmounts, which disposes the atom and stops listening.
onMounted(() => listen({ openSearch }));
const search = () => openSearch().then(() => focusPageSearch());

const online = useAtomValue(() => AppNetwork.online);
const status = computed(() =>
  AsyncResult.isSuccess(online.value) ? (online.value.value ? "online" : "offline") : "",
);

const theme = useAtomValue(() => ThemeAtoms.state);
const setPreference = useAtomSet(() => ThemeAtoms.setPreference);
const preference = computed(() =>
  AsyncResult.isSuccess(theme.value) ? theme.value.value.preference : Theme.defaultPreference,
);
const themeIcon = computed(() => ({ system: Monitor, light: Sun, dark: Moon })[preference.value]);
// system → light → dark → system
const cycleTheme = () => {
  const index = Theme.preferences.indexOf(preference.value);
  setPreference(Theme.preferences[(index + 1) % Theme.preferences.length] ?? "system");
};
</script>

<template>
  <header
    class="sticky top-0 z-10 border-b border-hairline bg-background pt-[env(safe-area-inset-top)]"
  >
    <div
      class="mx-auto flex max-w-[1040px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 sm:flex-nowrap sm:px-6"
    >
      <RouterLink :to="{ name: 'links' }" class="text-[15px] font-semibold tracking-tight">
        stash
      </RouterLink>

      <!-- On phones the nav takes its own row and scrolls sideways instead of overflowing. -->
      <nav
        aria-label="Main"
        class="order-last -mx-4 w-[calc(100%+2rem)] overflow-x-auto px-4 [scrollbar-width:none] sm:order-none sm:mx-0 sm:w-auto sm:px-0"
      >
        <div :class="segmentedControlVariants()">
          <RouterLink
            v-for="item in nav"
            :key="item.name"
            v-slot="{ href, navigate }"
            :to="{ name: item.name }"
            custom
          >
            <a
              :href="href"
              :aria-current="item === current ? 'page' : undefined"
              :class="segmentedControlItemVariants({ active: item === current })"
              @click="navigate"
            >
              {{ item.label }}
            </a>
          </RouterLink>
        </div>
      </nav>

      <div class="ml-auto flex shrink-0 items-center gap-2">
        <span
          data-testid="sync-status"
          aria-live="polite"
          class="font-mono text-xs"
          :class="status === 'offline' ? 'text-foreground' : 'text-muted-foreground'"
        >
          {{ status }}
        </span>
        <Button size="sm" v-bind="{ onClick: search, 'aria-keyshortcuts': 'Meta+K Control+K' }">
          <Search aria-hidden="true" />
          Search
          <Kbd class="hidden sm:inline-flex">⌘K</Kbd>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          v-bind="{
            onClick: cycleTheme,
            'aria-label': `Theme: ${preference}`,
            title: `Theme: ${preference}`,
          }"
        >
          <component :is="themeIcon" aria-hidden="true" />
        </Button>
        <LogoutButton />
      </div>
    </div>
  </header>
</template>
