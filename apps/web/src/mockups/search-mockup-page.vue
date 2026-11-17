<script setup lang="ts">
import { Clock } from "@lucide/vue";
import FilterMenu from "@stash/web-ui/filter-menu";
import GroupHeader from "@stash/web-ui/group-header";
import Kbd from "@stash/web-ui/kbd";
import ListRow from "@stash/web-ui/list-row";
import ListRowTitle from "@stash/web-ui/list-row-title";
import SearchField from "@stash/web-ui/search-field";
import SegmentedControl from "@stash/web-ui/segmented-control";
import { ref } from "vue";
import * as MockupData from "./mockup-data.ts";
import MockupLinkRow from "./mockup-link-row.vue";
import MockupShell from "./mockup-shell.vue";

// Mockup for #148 (dev-only, `/_mockups/search` and `/_mockups/search-empty`): the search field is
// the page's header, filters sit under it as one row of menus, results are the Inbox's media rows
// with the matches marked. With no query the page offers recent searches and the latest links.
// All data is made up.
const props = defineProps<{ empty?: boolean }>();

const q = ref(props.empty ? "" : MockupData.query);

const modes = [
  { value: "hybrid", label: "Hybrid" },
  { value: "semantic", label: "Meaning" },
  { value: "keyword", label: "Keywords" },
] as const;
const mode = ref<(typeof modes)[number]["value"]>("hybrid");

const types = [
  { value: "article", label: "Article" },
  { value: "video", label: "Video" },
  { value: "tool", label: "Tool" },
  { value: "repo", label: "Repo" },
] as const;
const type = ref<(typeof types)[number]["value"] | "">("");

const devices = [
  { value: "iphone", label: "iPhone" },
  { value: "work", label: "Work laptop" },
  { value: "home", label: "Home desktop" },
] as const;
const device = ref<(typeof devices)[number]["value"] | "">("");

const ranges = [
  { value: "week", label: "Past week" },
  { value: "month", label: "Past month" },
  { value: "year", label: "Past year" },
] as const;
const range = ref<(typeof ranges)[number]["value"] | "">("");
</script>

<template>
  <MockupShell current="Search">
    <section class="flex flex-col gap-6">
      <h1 class="sr-only">Search</h1>
      <form class="flex flex-col gap-3" role="search" @submit.prevent>
        <SearchField
          v-model="q"
          size="lg"
          v-bind="{
            'aria-label': 'Search links',
            placeholder: 'Search titles, summaries and page text',
            autofocus: true,
          }"
        />
        <div class="flex flex-wrap items-center gap-2">
          <div class="flex flex-wrap items-center gap-2" role="group" aria-label="Filters">
            <FilterMenu v-model="type" label="Type" :options="types" />
            <FilterMenu v-model="device" label="Device" :options="devices" />
            <FilterMenu v-model="range" label="Date" :options="ranges" />
          </div>
          <SegmentedControl
            v-if="q !== ''"
            v-model="mode"
            class="sm:ml-auto"
            label="Search mode"
            size="sm"
            :options="modes"
          />
        </div>
      </form>

      <template v-if="q !== ''">
        <section class="flex flex-col gap-2">
          <GroupHeader title="Results" :count="MockupData.results.length" />
          <ul class="flex flex-col" aria-label="Results">
            <MockupLinkRow
              v-for="link in MockupData.results"
              :key="link.id"
              :link="link"
              :highlight="q"
            />
          </ul>
        </section>
        <footer
          class="hidden flex-wrap items-center gap-x-4 gap-y-2 text-meta text-muted-foreground sm:flex"
        >
          <span class="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> move</span>
          <span class="flex items-center gap-1"><Kbd>↵</Kbd> open</span>
          <span class="flex items-center gap-1"><Kbd>S</Kbd> seen</span>
          <span class="flex items-center gap-1"><Kbd>esc</Kbd> clear</span>
        </footer>
      </template>

      <div v-else class="flex flex-col gap-8">
        <section class="flex flex-col gap-2">
          <GroupHeader title="Recent searches" />
          <ul class="flex flex-col">
            <ListRow v-for="item in MockupData.recentSearches" :key="item.query" as="li">
              <template #leading><Clock class="w-4" aria-hidden="true" /></template>
              <template #title>
                <ListRowTitle as-child>
                  <a href="#search">{{ item.query }}</a>
                </ListRowTitle>
              </template>
              <template #meta>
                <span>{{ item.age }}</span>
              </template>
            </ListRow>
          </ul>
        </section>
        <section class="flex flex-col gap-2">
          <GroupHeader title="Recently saved" />
          <ul class="flex flex-col">
            <MockupLinkRow v-for="link in MockupData.recentLinks" :key="link.id" :link="link" />
          </ul>
        </section>
      </div>
    </section>
  </MockupShell>
</template>
