<script setup lang="ts">
import type * as Device from "@stash/contracts-domain/device";
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
  /** Where the action leads: a page of the docs, which `apps/web` serves, or a new device. */
  readonly to: { readonly doc: string } | { readonly kind: Device.DeviceKind };
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
        to: { kind: "zen" },
      },
      {
        id: "iphone",
        title: "iPhone",
        description: "Save from the Share sheet with a Shortcut",
        action: "Set up",
        to: { doc: "/docs/ios-shortcut.md" },
      },
      {
        id: "claude",
        title: "Claude",
        description: "Save and search from a chat with the MCP connector",
        action: "Set up",
        to: { doc: "/docs/mcp-connector.md" },
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
        to: { kind: "zen" },
      },
      {
        id: "iphone",
        title: "iPhone",
        description: "Needs a Mac running the Stash agent, which reads your iCloud Tabs",
        action: "Add Mac",
        to: { kind: "mac-agent" },
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
            <a
              v-if="'doc' in option.to"
              :href="option.to.doc"
              target="_blank"
              rel="noopener noreferrer"
            >
              {{ option.action }}
            </a>
            <RouterLink
              v-else
              :to="{ name: 'settings', query: { add: 'device', kind: option.to.kind } }"
            >
              {{ option.action }}
            </RouterLink>
          </Button>
        </template>
      </ListRow>
    </ul>
  </Card>
</template>
