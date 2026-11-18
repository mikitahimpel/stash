<script setup lang="ts">
import Button from "@stash/web-ui/button";
import Card from "@stash/web-ui/card";
import CardHeader from "@stash/web-ui/card-header";
import CardTitle from "@stash/web-ui/card-title";
import ListRow from "@stash/web-ui/list-row";
import ListRowTitle from "@stash/web-ui/list-row-title";
import { computed } from "vue";
import { RouterLink } from "vue-router";

const props = defineProps<{
  /** `links`: the ways to save a link (Inbox). `tabs`: the devices that report tabs (Open now). */
  scenario: "links" | "tabs";
}>();

interface Option {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly action: string;
  /** The guide of the Connect page it opens (`/settings?guide=…`). */
  readonly guide: "iphone" | "extension" | "mac" | "claude";
}

const cards: Readonly<
  Record<typeof props.scenario, { title: string; options: ReadonlyArray<Option> }>
> = {
  links: {
    title: "Start saving",
    options: [
      {
        id: "zen",
        title: "Zen extension",
        description: "Save the current tab with a hotkey",
        action: "Set up",
        guide: "extension",
      },
      {
        id: "iphone",
        title: "iPhone",
        description: "Save from the Share sheet with a Shortcut",
        action: "Set up",
        guide: "iphone",
      },
      {
        id: "claude",
        title: "Claude",
        description: "Save and search from a chat with the MCP connector",
        action: "Set up",
        guide: "claude",
      },
    ],
  },
  tabs: {
    title: "Connect a device",
    options: [
      {
        id: "zen",
        title: "Zen extension",
        description: "Reports the tabs open in Zen",
        action: "Add Zen",
        guide: "extension",
      },
      {
        id: "iphone",
        title: "iPhone",
        description: "Needs a Mac running the Stash agent, which reads your iCloud Tabs",
        action: "Add Mac",
        guide: "mac",
      },
    ],
  },
};

const card = computed(() => cards[props.scenario]);

// First-run onboarding: a card, each row one way to start with one action.
</script>

<template>
  <Card data-slot="start-saving" v-bind="{ 'aria-label': card.title, role: 'region' }">
    <CardHeader>
      <CardTitle as="h2">{{ card.title }}</CardTitle>
    </CardHeader>
    <ul>
      <ListRow v-for="option in card.options" :key="option.id" as="li" :data-option="option.id">
        <template #title>
          <ListRowTitle>{{ option.title }}</ListRowTitle>
        </template>
        <template #meta>
          <span>{{ option.description }}</span>
        </template>
        <template #trailing>
          <Button as-child variant="secondary" size="sm">
            <RouterLink :to="{ name: 'settings', query: { guide: option.guide } }">
              {{ option.action }}
            </RouterLink>
          </Button>
        </template>
      </ListRow>
    </ul>
  </Card>
</template>
