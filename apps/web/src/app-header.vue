<script setup lang="ts">
import { useAtomSet, useAtomValue } from "@effect/atom-vue";
import { Monitor, Moon, Sun } from "@lucide/vue";
import AccountMenu from "@stash/web-auth/account-menu";
import * as Theme from "@stash/web-platform/theme";
import DropdownMenuLabel from "@stash/web-ui/dropdown-menu-label";
import DropdownMenuRadioGroup from "@stash/web-ui/dropdown-menu-radio-group";
import DropdownMenuRadioItem from "@stash/web-ui/dropdown-menu-radio-item";
import DropdownMenuSeparator from "@stash/web-ui/dropdown-menu-separator";
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

// The Search tab also takes the focus to the field, even when the page is already open.
const follow = async (
  item: (typeof nav)[number],
  event: MouseEvent,
  navigate: (event?: MouseEvent) => Promise<unknown>,
) => {
  await navigate(event);
  if (item.name !== "search") return;
  await nextTick();
  focusPageSearch();
};

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
  <header
    class="sticky top-0 z-10 border-b border-hairline bg-background pt-[env(safe-area-inset-top)]"
  >
    <!-- One quiet row, with the same width and side padding as <main>, so it lines up with the
         content. -->
    <div class="mx-auto flex h-14 max-w-[960px] items-center gap-8 px-4 sm:px-6">
      <RouterLink :to="{ name: 'links' }" class="text-[15px] font-semibold tracking-tight">
        stash
      </RouterLink>

      <!-- Plain text tabs. On phones they are a bottom bar (fixed, above the home indicator); from
           sm up they sit in the header, with the indicator on its bottom edge. -->
      <nav
        aria-label="Main"
        class="fixed inset-x-0 bottom-0 z-10 flex border-t border-hairline bg-background px-4 pb-[env(safe-area-inset-bottom)] sm:static sm:z-auto sm:h-14 sm:gap-6 sm:border-0 sm:bg-transparent sm:p-0"
      >
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
            :aria-keyshortcuts="item.name === 'search' ? 'Meta+K Control+K' : undefined"
            class="inline-flex h-12 flex-1 items-center justify-center gap-2 border-b-2 text-[13px] font-medium whitespace-nowrap transition-colors sm:h-full sm:flex-none"
            :class="
              item === current
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            "
            @click="follow(item, $event, navigate)"
          >
            {{ item.label }}
            <kbd
              v-if="item.name === 'search'"
              aria-hidden="true"
              class="hidden font-mono text-[11px] font-normal text-muted-foreground sm:inline"
              >⌘K</kbd
            >
          </a>
        </RouterLink>
      </nav>

      <div class="ml-auto flex shrink-0 items-center">
        <!-- The status lives in the menu; the button only speaks up when the device is offline. -->
        <AccountMenu :alert="status === 'Offline' ? 'offline' : undefined">
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
          <DropdownMenuSeparator />
          <DropdownMenuLabel
            class="flex items-center gap-2"
            v-bind="{ title: statusHint, 'data-testid': 'sync-status' }"
          >
            <span
              aria-hidden="true"
              class="size-2 rounded-full"
              :class="status === 'Offline' ? 'bg-signal' : 'bg-muted-foreground'"
            />
            <span aria-live="polite">{{ status }}</span>
          </DropdownMenuLabel>
        </AccountMenu>
      </div>
    </div>
  </header>
</template>
