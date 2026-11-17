<script setup lang="ts">
import Button from "@stash/web-ui/button";
import FilterMenu from "@stash/web-ui/filter-menu";
import GroupHeader from "@stash/web-ui/group-header";
import Input from "@stash/web-ui/input";
import Kbd from "@stash/web-ui/kbd";
import PageHeader from "@stash/web-ui/page-header";
import SegmentedControl from "@stash/web-ui/segmented-control";
import { ref } from "vue";
import * as MockupData from "./mockup-data.ts";
import MockupLinkRow from "./mockup-link-row.vue";
import MockupShell from "./mockup-shell.vue";

// Mockup for #148 (dev-only, `/_mockups/inbox`): the Inbox with its page header back, the filter
// bar under it, days as group headers and links as media rows. All data is made up.

const feeds = [
  { value: "unseen", label: "Not yet seen" },
  { value: "recent", label: "Recent" },
  { value: "all", label: "All" },
] as const;
const feed = ref<(typeof feeds)[number]["value"]>("recent");

const types = [
  { value: "article", label: "Article" },
  { value: "video", label: "Video" },
  { value: "tool", label: "Tool" },
  { value: "repo", label: "Repo" },
] as const;
const type = ref<(typeof types)[number]["value"] | "">("");
</script>

<template>
  <MockupShell current="Inbox">
    <section class="flex flex-col gap-6">
      <PageHeader title="Inbox" subtitle="6 unread · 30 saved in 30 days">
        <template #actions>
          <form class="flex w-full gap-2 sm:w-80" @submit.prevent>
            <Input v-bind="{ placeholder: 'Save a link', 'aria-label': 'Save a link' }" />
            <Button as-child variant="primary">
              <button type="submit">Save</button>
            </Button>
          </form>
        </template>
      </PageHeader>

      <div class="flex flex-wrap items-center gap-2">
        <SegmentedControl v-model="feed" label="Feed" size="sm" :options="feeds" />
        <FilterMenu v-model="type" label="Type" :options="types" />
      </div>

      <div class="flex flex-col gap-8">
        <section v-for="day in MockupData.days" :key="day.label" class="flex flex-col gap-2">
          <GroupHeader :title="day.label" :count="day.links.length" />
          <ul class="flex flex-col">
            <MockupLinkRow
              v-for="link in day.links"
              :key="link.id"
              :link="link"
              :selected="link.id === MockupData.selectedId"
            />
          </ul>
        </section>
      </div>

      <p
        class="hidden flex-wrap items-center gap-x-4 gap-y-2 text-meta text-muted-foreground sm:flex"
      >
        <span class="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> select</span>
        <span class="flex items-center gap-1"><Kbd>↵</Kbd> open</span>
        <span class="flex items-center gap-1"><Kbd>S</Kbd> seen</span>
        <span class="flex items-center gap-1"><Kbd>D</Kbd> done</span>
        <span class="flex items-center gap-1"><Kbd>E</Kbd> archive</span>
      </p>
    </section>
  </MockupShell>
</template>
