<script setup lang="ts">
import { useAtomSet, useAtomValue } from "@effect/atom-vue";
import { Archive, ExternalLink, MoreHorizontal, Plus } from "@lucide/vue";
import type * as Theme from "@stash/web-platform/theme";
import Badge from "@stash/web-ui/badge";
import Button from "@stash/web-ui/button";
import Dialog from "@stash/web-ui/dialog";
import DialogClose from "@stash/web-ui/dialog-close";
import DialogContent from "@stash/web-ui/dialog-content";
import DialogDescription from "@stash/web-ui/dialog-description";
import DialogFooter from "@stash/web-ui/dialog-footer";
import DialogHeader from "@stash/web-ui/dialog-header";
import DialogTitle from "@stash/web-ui/dialog-title";
import DialogTrigger from "@stash/web-ui/dialog-trigger";
import DropdownMenu from "@stash/web-ui/dropdown-menu";
import DropdownMenuContent from "@stash/web-ui/dropdown-menu-content";
import DropdownMenuItem from "@stash/web-ui/dropdown-menu-item";
import DropdownMenuLabel from "@stash/web-ui/dropdown-menu-label";
import DropdownMenuRadioGroup from "@stash/web-ui/dropdown-menu-radio-group";
import DropdownMenuRadioItem from "@stash/web-ui/dropdown-menu-radio-item";
import DropdownMenuSeparator from "@stash/web-ui/dropdown-menu-separator";
import DropdownMenuTrigger from "@stash/web-ui/dropdown-menu-trigger";
import EmptyState from "@stash/web-ui/empty-state";
import ErrorState from "@stash/web-ui/error-state";
import Input from "@stash/web-ui/input";
import Kbd from "@stash/web-ui/kbd";
import ListRow from "@stash/web-ui/list-row";
import SearchField from "@stash/web-ui/search-field";
import PageHeader from "@stash/web-ui/page-header";
import SectionHeader from "@stash/web-ui/section-header";
import SegmentedControl from "@stash/web-ui/segmented-control";
import type { SegmentedControlOption } from "@stash/web-ui/segmented-control-option";
import Skeleton from "@stash/web-ui/skeleton";
import TextLink from "@stash/web-ui/text-link";
import type { ToastMessage } from "@stash/web-ui/toast-message";
import Toaster from "@stash/web-ui/toaster";
import ToggleChip from "@stash/web-ui/toggle-chip";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { computed, ref } from "vue";
import * as ThemeAtoms from "@stash/web-settings/theme-atoms";

// Dev-only: every primitive of @stash/web-ui in every state, with a theme switch. Mounted at /_ui
// in dev only (see `devRoutes` in app-router.ts). All data here is made up.

const theme = useAtomValue(() => ThemeAtoms.state);
const setPreference = useAtomSet(() => ThemeAtoms.setPreference);
const preference = computed({
  get: (): Theme.Preference =>
    AsyncResult.isSuccess(theme.value) ? theme.value.value.preference : "system",
  set: (value) => setPreference(value),
});
const scheme = computed(() =>
  AsyncResult.isSuccess(theme.value) ? theme.value.value.scheme : "…",
);
const themes: ReadonlyArray<SegmentedControlOption<Theme.Preference>> = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const view = ref<"inbox" | "open-now" | "search" | "settings">("inbox");
const views: ReadonlyArray<SegmentedControlOption<typeof view.value>> = [
  { value: "inbox", label: "Inbox" },
  { value: "open-now", label: "Open now" },
  { value: "search", label: "Search" },
  { value: "settings", label: "Settings" },
];

const video = ref(true);
const article = ref(false);
const query = ref("");
const filled = ref("economics video");
const text = ref("Example device");

const rows = [
  {
    title: "How interest rates move markets",
    host: "example.com",
    device: "zen-laptop",
    age: "2d",
  },
  { title: "A field guide to small tools", host: "example.org", device: "iphone", age: "9d" },
  {
    title: "Notes on keyboard-first interfaces",
    host: "example.net",
    device: "zen-desk",
    age: "3w",
  },
] as const;
const selected = ref(1);
const sort = ref("recent");

const toasts = ref<ReadonlyArray<ToastMessage>>([]);
let toastCount = 0;
const toast = (variant: ToastMessage["variant"]) => {
  toastCount++;
  toasts.value = [
    ...toasts.value,
    variant === "destructive"
      ? { id: `t${toastCount}`, title: "Couldn't archive the tab", variant }
      : { id: `t${toastCount}`, title: "Archived", description: "example.com" },
  ];
};
const dismiss = (id: string) => {
  toasts.value = toasts.value.filter((t) => t.id !== id);
};

const swatches = [
  "background",
  "surface",
  "foreground",
  "muted-foreground",
  "hairline",
  "hairline-row",
  "signal",
  "destructive",
] as const;
</script>

<template>
  <div class="min-h-dvh bg-background text-foreground">
    <div class="mx-auto flex max-w-[1040px] flex-col gap-10 px-4 py-8 sm:px-6">
      <header class="flex flex-wrap items-center gap-3">
        <h1 class="text-sm font-medium">stash / ui</h1>
        <span class="font-mono text-xs text-muted-foreground">{{ scheme }}</span>
        <SegmentedControl v-model="preference" :options="themes" label="Theme" class="ml-auto" />
      </header>

      <section class="flex flex-col gap-3">
        <SectionHeader title="Tokens" :count="swatches.length" />
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div v-for="name in swatches" :key="name" class="flex items-center gap-2">
            <span
              class="size-6 shrink-0 rounded-md border border-hairline"
              :style="{ background: `var(--${name})` }"
            />
            <span class="font-mono text-xs text-muted-foreground">{{ name }}</span>
          </div>
        </div>
        <div class="flex flex-col gap-1">
          <p class="text-[15px]">List title 15px</p>
          <p class="text-sm">Body 14px</p>
          <p class="text-[13px]">Control 13px</p>
          <p class="font-mono text-xs text-muted-foreground">example.com · zen-laptop · 2d · 12</p>
          <p class="text-signal">Accent: stale / unread / match marks only</p>
        </div>
      </section>

      <section class="flex flex-col gap-3">
        <SectionHeader title="Button" />
        <div
          v-for="variant in ['raised', 'primary', 'ghost'] as const"
          :key="variant"
          class="flex flex-wrap items-center gap-3"
        >
          <span class="w-16 font-mono text-xs text-muted-foreground">{{ variant }}</span>
          <Button :variant="variant">Save</Button>
          <Button :variant="variant" size="sm">Small</Button>
          <Button :variant="variant" size="lg">Large</Button>
          <Button :variant="variant"><Plus />With icon</Button>
          <Button :variant="variant" size="icon" v-bind="{ 'aria-label': 'Archive' }"
            ><Archive
          /></Button>
          <Button :variant="variant" v-bind="{ disabled: true }">Disabled</Button>
        </div>
        <div class="flex flex-wrap items-center gap-3">
          <span class="w-16 font-mono text-xs text-muted-foreground">legacy</span>
          <Button variant="destructive">Delete</Button>
          <Button variant="link">Link</Button>
        </div>
      </section>

      <section class="flex flex-col gap-3">
        <SectionHeader title="SegmentedControl" />
        <SegmentedControl v-model="view" :options="views" label="View" />
        <span class="font-mono text-xs text-muted-foreground">{{ view }}</span>
      </section>

      <section class="flex flex-col gap-3">
        <SectionHeader title="ToggleChip" />
        <div class="flex flex-wrap gap-2">
          <ToggleChip v-model:pressed="video">Video</ToggleChip>
          <ToggleChip v-model:pressed="article">Article</ToggleChip>
          <ToggleChip :pressed="true" disabled>On, disabled</ToggleChip>
          <ToggleChip disabled>Off, disabled</ToggleChip>
        </div>
      </section>

      <section class="flex flex-col gap-3">
        <SectionHeader title="SearchField · Input" />
        <div class="grid gap-3 sm:grid-cols-2">
          <SearchField
            v-model="query"
            shortcut="⌘K"
            v-bind="{ placeholder: 'Search', 'aria-label': 'Search' }"
          />
          <SearchField
            v-model="filled"
            v-bind="{ placeholder: 'Search', 'aria-label': 'Search, filled' }"
          />
          <SearchField
            v-bind="{ placeholder: 'Disabled', 'aria-label': 'Search, disabled', disabled: true }"
          />
          <Input
            :model-value="text"
            v-bind="{ 'aria-label': 'Device name' }"
            @update:model-value="(value) => (text = String(value ?? ''))"
          />
          <Input v-bind="{ placeholder: 'Placeholder', 'aria-label': 'Placeholder' }" />
          <Input
            model-value="not a url"
            v-bind="{ 'aria-invalid': true, 'aria-label': 'Invalid' }"
          />
          <Input v-bind="{ placeholder: 'Disabled', 'aria-label': 'Disabled', disabled: true }" />
        </div>
      </section>

      <section class="flex flex-col gap-3">
        <SectionHeader title="Kbd" />
        <div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Kbd>⌘</Kbd><Kbd>K</Kbd> search <Kbd>J</Kbd><Kbd>K</Kbd> move <Kbd>E</Kbd> archive
          <Kbd>↵</Kbd> open
        </div>
      </section>

      <section class="flex flex-col gap-1">
        <SectionHeader title="ListRow" :count="rows.length">
          <template #actions>
            <Button variant="ghost" size="sm">Mark all read</Button>
          </template>
        </SectionHeader>
        <ListRow
          v-for="(row, index) in rows"
          :key="row.title"
          :selected="index === selected"
          v-bind="{ onClick: () => (selected = index) }"
        >
          <template #default>
            <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <TextLink v-bind="{ href: 'https://example.com/' }" class="text-[15px]">{{
                row.title
              }}</TextLink>
              <span class="font-mono text-xs text-muted-foreground">{{ row.host }}</span>
              <span class="font-mono text-xs text-muted-foreground">{{ row.device }}</span>
              <span
                class="ml-auto font-mono text-xs"
                :class="row.age === '3w' ? 'text-signal' : 'text-muted-foreground'"
                >{{ row.age }}</span
              >
            </div>
          </template>
          <template #actions>
            <Button size="sm"><ExternalLink />Open</Button>
            <Button size="sm"><Archive />Archive</Button>
            <Button variant="ghost" size="sm">Close on device</Button>
          </template>
        </ListRow>
      </section>

      <section class="flex flex-col gap-3">
        <SectionHeader title="PageHeader · SectionHeader · TextLink · Badge" :count="4" />
        <PageHeader title="Open now" subtitle="17 tabs · 3 devices · 6 older than 7 days" />
        <p class="text-sm">
          A <TextLink v-bind="{ href: 'https://example.com/' }">text link</TextLink> brightens its
          underline on hover.
        </p>
        <div class="flex flex-wrap gap-2">
          <Badge>default</Badge>
          <Badge variant="secondary">secondary</Badge>
          <Badge variant="outline">#outline</Badge>
          <Badge variant="destructive">destructive</Badge>
        </div>
      </section>

      <section class="flex flex-col gap-3">
        <SectionHeader title="Dialog · DropdownMenu · Toast" />
        <div class="flex flex-wrap gap-3">
          <Dialog>
            <DialogTrigger as-child>
              <Button>Open dialog</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Revoke token</DialogTitle>
                <DialogDescription>zen-laptop · created 2d ago</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose as-child><Button variant="ghost">Cancel</Button></DialogClose>
                <DialogClose as-child><Button variant="primary">Revoke</Button></DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button size="icon" v-bind="{ 'aria-label': 'More' }"><MoreHorizontal /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>example.com</DropdownMenuLabel>
              <DropdownMenuItem>Open</DropdownMenuItem>
              <DropdownMenuItem>Archive</DropdownMenuItem>
              <DropdownMenuItem disabled>Close on device</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive">Delete</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button>Sort</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>Sort</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                :model-value="sort"
                @update:model-value="(value) => (sort = String(value))"
              >
                <DropdownMenuRadioItem value="recent">Recent</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="oldest">Oldest</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button v-bind="{ onClick: () => toast('default') }">Toast</Button>
          <Button v-bind="{ onClick: () => toast('destructive') }">Error toast</Button>
        </div>
      </section>

      <section class="flex flex-col gap-3">
        <SectionHeader title="EmptyState · ErrorState · Skeleton" />
        <EmptyState title="Nothing open" description="No device reported open tabs." />
        <ErrorState title="Couldn't load open tabs" @retry="toast('default')" />
        <div class="flex flex-col gap-2" aria-busy="true">
          <Skeleton class="h-5 w-2/3" />
          <Skeleton class="h-4 w-1/3" />
        </div>
      </section>
    </div>
    <Toaster :toasts="toasts" @dismiss="dismiss" />
  </div>
</template>
