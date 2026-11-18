<script setup lang="ts">
import { Monitor, Moon, Sun } from "@lucide/vue";
import AccountMenu from "@stash/web-auth/account-menu";
import * as Theme from "@stash/web-platform/theme";
import SearchBox from "@stash/web-search/search-box";
import AppBar from "@stash/web-ui/app-bar";
import AppBarSearch from "@stash/web-ui/app-bar-search";
import DropdownMenuLabel from "@stash/web-ui/dropdown-menu-label";
import DropdownMenuRadioGroup from "@stash/web-ui/dropdown-menu-radio-group";
import DropdownMenuRadioItem from "@stash/web-ui/dropdown-menu-radio-item";
import DropdownMenuSeparator from "@stash/web-ui/dropdown-menu-separator";
import LogoMark from "@stash/web-ui/logo-mark";
import NavBar from "@stash/web-ui/nav-bar";
import NavTab from "@stash/web-ui/nav-tab";
import StatusDot from "@stash/web-ui/status-dot";
import Wordmark from "@stash/web-ui/wordmark";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { injectRegistry, useAtomSet, useAtomValue } from "@effect/atom-vue";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import * as AppNetwork from "./app-network.ts";
import * as AppPrefetch from "./app-prefetch.ts";
import * as AppShortcuts from "./app-shortcuts.ts";
import * as ThemeAtoms from "@stash/web-settings/theme-atoms";

const route = useRoute();
const router = useRouter();

// Search is not a tab: its field sits in the bar on every page. `under` lists the pages that
// belong to a section without living under its path (the extension's approve page).
const nav = [
  { name: "links", label: "Inbox", under: [] },
  { name: "open-tabs", label: "Open now", under: [] },
  { name: "settings", label: "Settings", under: ["/connect"] },
] as const;

// Where a navigation that is still running leads. The tab of that page is marked from the click
// on, so a page that has to wait (for its code, on a first visit) answers the click at once.
const heading = ref<string>();
const stopBefore = router.beforeEach((to) => {
  heading.value = to.path;
});
const stopAfter = router.afterEach(() => {
  heading.value = undefined;
});
const stopError = router.onError(() => {
  heading.value = undefined;
});
onBeforeUnmount(() => {
  stopBefore();
  stopAfter();
  stopError();
});

// The section of the current page. Pages below a section (`/links/:id`) keep it marked.
const current = computed(() => {
  const here = heading.value ?? route.path;
  return nav.find((item) =>
    [router.resolve({ name: item.name }).path, ...item.under].some(
      (path) => here === path || here.startsWith(`${path}/`),
    ),
  );
});

// The pointer, a finger or the keyboard focus on a tab: its code and first data load before the
// click (and a tab that was open refreshes its cached data).
const registry = injectRegistry();
// The tab of the page that is open is left alone: its page reads its data already.
const prefetch = (name: string) => {
  if (route.name !== name) AppPrefetch.prefetch(name, registry);
};

const listen = useAtomSet(() => AppShortcuts.listen);
// Runs until the header unmounts, which disposes the atom and stops listening.
onMounted(() => listen());

const online = useAtomValue(() => AppNetwork.online);
const status = computed(() =>
  AsyncResult.isSuccess(online.value) ? (online.value.value ? "Online" : "Offline") : "",
);
const statusHint = computed(() =>
  status.value === "Offline"
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
const pickTheme = (value: unknown) => {
  const option = themes.find((candidate) => candidate.value === value);
  if (option !== undefined) setPreference(option.value);
};
</script>

<template>
  <AppBar>
    <Wordmark as-child>
      <RouterLink :to="{ name: 'links' }"><LogoMark /><span>stash</span></RouterLink>
    </Wordmark>

    <NavBar label="Main">
      <RouterLink
        v-for="item in nav"
        :key="item.name"
        v-slot="{ href, navigate }"
        :to="{ name: item.name }"
        custom
      >
        <NavTab as-child :active="item === current">
          <a
            :href="href"
            :aria-current="item === current ? 'page' : undefined"
            @click="navigate"
            @pointerenter="prefetch(item.name)"
            @touchstart.passive="prefetch(item.name)"
            @focus="prefetch(item.name)"
          >
            {{ item.label }}
          </a>
        </NavTab>
      </RouterLink>
    </NavBar>

    <AppBarSearch><SearchBox /></AppBarSearch>

    <div class="flex shrink-0 items-center">
      <!-- The status lives in the menu; the button only speaks up when the device is offline. -->
      <AccountMenu :alert="status === 'Offline' ? 'offline' : undefined">
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup :model-value="preference" @update:model-value="pickTheme">
          <DropdownMenuRadioItem v-for="option in themes" :key="option.value" :value="option.value">
            <component :is="option.icon" aria-hidden="true" />
            {{ option.label }}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel
          class="flex items-center gap-2"
          v-bind="{ title: statusHint, 'data-testid': 'sync-status' }"
        >
          <StatusDot :tone="status === 'Offline' ? 'signal' : 'muted'" />
          <span aria-live="polite">{{ status }}</span>
        </DropdownMenuLabel>
      </AccountMenu>
    </div>
  </AppBar>
</template>
