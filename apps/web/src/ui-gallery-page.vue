<script setup lang="ts">
import { useAtomSet, useAtomValue } from "@effect/atom-vue";
import { Archive, ExternalLink, MoreHorizontal, Plus } from "@lucide/vue";
import type { ControlSize } from "@stash/web-ui/control-variants";
import type * as Theme from "@stash/web-platform/theme";
import AppFrame from "@stash/web-ui/app-frame";
import AppMain from "@stash/web-ui/app-main";
import AvatarButton from "@stash/web-ui/avatar-button";
import Badge from "@stash/web-ui/badge";
import Button from "@stash/web-ui/button";
import Card from "@stash/web-ui/card";
import CardHeader from "@stash/web-ui/card-header";
import CardTitle from "@stash/web-ui/card-title";
import ColorSwatch from "@stash/web-ui/color-swatch";
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
import ListRowTitle from "@stash/web-ui/list-row-title";
import SearchField from "@stash/web-ui/search-field";
import PageHeader from "@stash/web-ui/page-header";
import SectionHeader from "@stash/web-ui/section-header";
import SegmentedControl from "@stash/web-ui/segmented-control";
import type { SegmentedControlOption } from "@stash/web-ui/segmented-control-option";
import FilterMenu from "@stash/web-ui/filter-menu";
import Skeleton from "@stash/web-ui/skeleton";
import Tabs from "@stash/web-ui/tabs";
import TabsList from "@stash/web-ui/tabs-list";
import TabsTrigger from "@stash/web-ui/tabs-trigger";
import TextLink from "@stash/web-ui/text-link";
import type { ToastMessage } from "@stash/web-ui/toast-message";
import Toaster from "@stash/web-ui/toaster";
import ToggleChip from "@stash/web-ui/toggle-chip";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { computed, ref } from "vue";
import * as ThemeAtoms from "@stash/web-settings/theme-atoms";

// Dev-only: every primitive of @stash/web-ui in every size and state, with a theme switch. Mounted at /_ui
// in dev only (see `devRoutes` in app-router.ts). All data here is made up.

const kinds = [
  { value: "article", label: "Article" },
  { value: "video", label: "Video" },
] as const;
const kind = ref<(typeof kinds)[number]["value"] | "">("");

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

// Every control in every size, side by side: rows are primitives, columns are sm 32 · md 36 · lg 44.
const sizes: ReadonlyArray<ControlSize> = ["sm", "md", "lg"];
const variants = ["raised", "primary", "ghost", "secondary", "destructive"] as const;
const iconSize = { sm: "icon-sm", md: "icon", lg: "icon-lg" } as const;
const tab = ref("inbox");

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
  <AppFrame>
    <AppMain>
      <div class="flex flex-col gap-12">
        <PageHeader title="stash / ui" :subtitle="`Every primitive, every size · ${scheme}`">
          <template #actions>
            <SegmentedControl v-model="preference" :options="themes" label="Theme" size="sm" />
          </template>
        </PageHeader>

        <section class="flex flex-col gap-3">
          <SectionHeader title="Controls" count="sm 32 · md 36 · lg 44" />
          <div class="overflow-x-auto">
            <div
              data-slot="gallery-grid"
              class="grid min-w-[36rem] grid-cols-[7rem_repeat(3,minmax(0,1fr))] items-center gap-x-4 gap-y-3 text-meta text-muted-foreground"
            >
              <span />
              <span v-for="size in sizes" :key="size">{{ size }}</span>

              <template v-for="variant in variants" :key="variant">
                <span>Button {{ variant }}</span>
                <div v-for="size in sizes" :key="size" class="flex items-center gap-2">
                  <Button :variant="variant" :size="size">Save</Button>
                  <Button :variant="variant" :size="iconSize[size]" v-bind="{ 'aria-label': 'Add' }"
                    ><Plus
                  /></Button>
                </div>
              </template>

              <span>Input</span>
              <Input
                v-for="size in sizes"
                :key="size"
                :size="size"
                v-bind="{ placeholder: 'Device name', 'aria-label': `Input ${size}` }"
              />

              <span>SearchField</span>
              <SearchField
                v-for="size in sizes"
                :key="size"
                :size="size"
                shortcut="/"
                v-bind="{ placeholder: 'Search', 'aria-label': `Search ${size}` }"
              />

              <span>SegmentedControl</span>
              <div v-for="size in ['sm', 'md'] as const" :key="size" class="flex">
                <SegmentedControl
                  v-model="view"
                  :options="views.slice(0, 3)"
                  label="View"
                  :size="size"
                />
              </div>
              <span>—</span>

              <span>ToggleChip</span>
              <div v-for="size in sizes" :key="size" class="flex gap-2">
                <ToggleChip v-model:pressed="video" :size="size">Video</ToggleChip>
                <ToggleChip v-model:pressed="article" :size="size">Article</ToggleChip>
              </div>

              <span>FilterMenu</span>
              <div v-for="size in ['sm', 'md'] as const" :key="size" class="flex">
                <FilterMenu v-model="kind" label="Type" :options="kinds" :size="size" />
              </div>
              <span>—</span>

              <span>Tabs</span>
              <span>—</span>
              <Tabs :model-value="tab" @update:model-value="(value) => (tab = String(value))">
                <TabsList>
                  <TabsTrigger value="inbox">Inbox</TabsTrigger>
                  <TabsTrigger value="open-now">Open now</TabsTrigger>
                </TabsList>
              </Tabs>
              <span>—</span>

              <span>Avatar · Kbd · Badge</span>
              <div class="flex items-center gap-2">
                <AvatarButton initial="E" v-bind="{ 'aria-label': 'Account' }" />
                <AvatarButton initial="E" alert v-bind="{ 'aria-label': 'Account (offline)' }" />
              </div>
              <div class="flex items-center gap-1">
                <Kbd>⌘</Kbd><Kbd>K</Kbd><Kbd>↵</Kbd><Kbd>E</Kbd>
              </div>
              <div class="flex flex-wrap items-center gap-2">
                <Badge>default</Badge>
                <Badge variant="outline">#outline</Badge>
              </div>

              <span>Disabled</span>
              <div class="flex"><Button size="sm" v-bind="{ disabled: true }">Save</Button></div>
              <Input
                v-bind="{ placeholder: 'Disabled', 'aria-label': 'Disabled', disabled: true }"
              />
              <div class="flex"><ToggleChip disabled size="lg">Off</ToggleChip></div>
            </div>
          </div>
        </section>

        <section class="flex flex-col gap-3">
          <SectionHeader title="Rows" :count="rows.length">
            <template #actions>
              <Button variant="ghost" size="sm">Mark all seen</Button>
            </template>
          </SectionHeader>
          <ul>
            <template v-for="(row, index) in rows" :key="row.title">
              <ListRow
                as="li"
                :selected="index === selected"
                v-bind="{ onClick: () => (selected = index) }"
              >
                <template #title>
                  <ListRowTitle as-child>
                    <a href="https://row.com/">{{ row.title }}</a>
                  </ListRowTitle>
                </template>
                <template #meta>
                  <span>{{ row.host }}</span>
                  <span>{{ row.device }}</span>
                  <span :class="row.age === '3w' && 'text-signal'">{{ row.age }}</span>
                </template>
                <template #default>
                  <p class="text-body text-muted-foreground">A one-line summary of the link.</p>
                </template>
                <template #actions>
                  <Button variant="ghost" size="sm"><ExternalLink />Open</Button>
                  <Button variant="ghost" size="sm"><Archive />Archive</Button>
                </template>
              </ListRow>
            </template>
            <ListRow as="li">
              <template #title><ListRowTitle>Work laptop</ListRowTitle></template>
              <template #meta><span>Zen</span><span>2m ago</span></template>
              <template #trailing><Button variant="ghost" size="sm">New token</Button></template>
            </ListRow>
            <ListRow as="li">
              <template #title><ListRowTitle muted>No tokens yet</ListRowTitle></template>
            </ListRow>
          </ul>
        </section>

        <section class="flex flex-col gap-3">
          <SectionHeader title="Card" />
          <Card>
            <CardHeader><CardTitle as="h2">Start saving</CardTitle></CardHeader>
            <ul>
              <ListRow as="li">
                <template #title><ListRowTitle>Zen extension</ListRowTitle></template>
                <template #meta><span>Save the current tab with a hotkey</span></template>
                <template #trailing><Button variant="secondary" size="sm">Set up</Button></template>
              </ListRow>
              <ListRow as="li">
                <template #title><ListRowTitle>iPhone</ListRowTitle></template>
                <template #meta><span>Save from the Share sheet</span></template>
                <template #trailing><Button variant="secondary" size="sm">Set up</Button></template>
              </ListRow>
            </ul>
          </Card>
        </section>

        <section class="flex flex-col gap-3">
          <SectionHeader title="Text" :count="swatches.length" />
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <ColorSwatch v-for="name in swatches" :key="name" :token="name" />
          </div>
          <div class="flex flex-col gap-1">
            <p class="text-label">Label 14/500: controls, row titles, section headers</p>
            <p class="text-body">Body 14/400</p>
            <p class="text-meta text-muted-foreground">
              Meta 13/400: example.com · Work laptop · 2d
            </p>
            <p class="text-body">
              A <TextLink v-bind="{ href: 'https://example.com/' }">text link</TextLink> inside
              prose. Row titles are never underlined.
            </p>
          </div>
        </section>

        <section class="flex flex-col gap-3">
          <SectionHeader title="Overlays" />
          <div class="flex flex-wrap gap-2">
            <Dialog>
              <DialogTrigger as-child>
                <Button>Open dialog</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Revoke token?</DialogTitle>
                  <DialogDescription>Work laptop can no longer reach Stash.</DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose as-child><Button>Cancel</Button></DialogClose>
                  <DialogClose as-child><Button variant="destructive">Revoke</Button></DialogClose>
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
          <SectionHeader title="Empty · Error · Loading" />
          <EmptyState title="Nothing open" description="No device reported open tabs." />
          <ErrorState title="Couldn't load open tabs" @retry="toast('default')" />
          <div class="flex flex-col gap-2" aria-busy="true">
            <Skeleton shape="title" class="w-2/3" />
            <Skeleton shape="row" />
            <Skeleton shape="control" />
            <Skeleton shape="chip" />
          </div>
        </section>
      </div>
    </AppMain>
    <Toaster :toasts="toasts" @dismiss="dismiss" />
  </AppFrame>
</template>
