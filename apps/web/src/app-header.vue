<script setup lang="ts">
import { useAtomSet, useAtomValue } from "@effect/atom-vue";
import { Monitor, Moon, Search as SearchIcon, Sun } from "@lucide/vue";
import AccountMenu from "@stash/web-auth/account-menu";
import * as Theme from "@stash/web-platform/theme";
import Button from "@stash/web-ui/button";
import DropdownMenu from "@stash/web-ui/dropdown-menu";
import DropdownMenuContent from "@stash/web-ui/dropdown-menu-content";
import DropdownMenuLabel from "@stash/web-ui/dropdown-menu-label";
import DropdownMenuRadioGroup from "@stash/web-ui/dropdown-menu-radio-group";
import DropdownMenuRadioItem from "@stash/web-ui/dropdown-menu-radio-item";
import DropdownMenuTrigger from "@stash/web-ui/dropdown-menu-trigger";
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
const statusHint = computed(() =>
  status.value === "offline"
    ? "Offline: showing what was loaded last"
    : "Online: changes sync as they happen",
);

const theme = useAtomValue(() => ThemeAtoms.state);
const setPreference = useAtomSet(() => ThemeAtoms.setPreference);
const preference = computed(() =>
  AsyncResult.isSuccess(theme.value) ? theme.value.value.preference : Theme.defaultPreference,
);
const themes = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
] as const;
const currentTheme = computed(
  () => themes.find((option) => option.value === preference.value) ?? themes[0],
);
const pickTheme = (value: unknown) => {
  const option = themes.find((candidate) => candidate.value === value);
  if (option !== undefined) setPreference(option.value);
};
</script>

<template>
  <header
    class="sticky top-0 z-10 border-b border-hairline bg-background pt-[env(safe-area-inset-top)]"
  >
    <!-- The same width and side padding as <main>, so the header lines up with the content. -->
    <div class="mx-auto flex h-14 max-w-[1040px] items-center gap-6 px-4 sm:px-6">
      <RouterLink :to="{ name: 'links' }" class="text-[15px] font-semibold tracking-tight">
        stash
      </RouterLink>

      <!-- On phones the nav is a bottom bar (fixed, above the home indicator); from sm up it sits
           in the header. -->
      <nav
        aria-label="Main"
        class="fixed inset-x-0 bottom-0 z-10 border-t border-hairline bg-background px-4 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:static sm:z-auto sm:border-0 sm:bg-transparent sm:p-0"
      >
        <div :class="[segmentedControlVariants(), 'flex w-full sm:inline-flex sm:w-auto']">
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
              :class="[
                segmentedControlItemVariants({ active: item === current }),
                'flex-1 px-2 sm:flex-none sm:px-3',
              ]"
              @click="navigate"
            >
              {{ item.label }}
            </a>
          </RouterLink>
        </div>
      </nav>

      <!-- The right side is one cluster: sync status, search, theme, account. -->
      <div class="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
        <span
          data-testid="sync-status"
          :title="statusHint"
          class="mr-1 flex items-center gap-2 font-mono text-xs text-muted-foreground sm:mr-2"
        >
          <span
            aria-hidden="true"
            class="size-2 rounded-full"
            :class="status === 'offline' ? 'bg-signal' : 'bg-muted-foreground'"
          />
          <span aria-live="polite" class="sr-only sm:not-sr-only">{{ status }}</span>
        </span>
        <Button
          size="sm"
          class="max-sm:w-10 max-sm:px-0"
          v-bind="{
            onClick: search,
            'aria-keyshortcuts': 'Meta+K Control+K',
            title: 'Search (⌘K)',
          }"
        >
          <SearchIcon aria-hidden="true" />
          <span class="sr-only sm:not-sr-only">Search</span>
          <Kbd class="hidden sm:inline-flex">⌘K</Kbd>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button
              variant="ghost"
              size="icon"
              v-bind="{
                'aria-label': `Theme: ${preference}`,
                title: `Theme: ${currentTheme.label}`,
                'data-test': 'theme-menu',
              }"
            >
              <component :is="currentTheme.icon" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="min-w-40">
            <DropdownMenuLabel>Theme</DropdownMenuLabel>
            <DropdownMenuRadioGroup :model-value="preference" @update:model-value="pickTheme">
              <DropdownMenuRadioItem
                v-for="option in themes"
                :key="option.value"
                :value="option.value"
              >
                <component :is="option.icon" aria-hidden="true" />
                {{ option.label }}
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <AccountMenu />
      </div>
    </div>
  </header>
</template>
