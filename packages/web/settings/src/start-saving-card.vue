<script setup lang="ts">
import type * as Device from "@stash/contracts-domain/device";
import Button from "@stash/web-ui/button";
import ListRow from "@stash/web-ui/list-row";
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
        action: "Add device",
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
        action: "Connect",
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
</script>

<template>
  <!-- First-run onboarding: each row is one way to start, with one action. -->
  <section
    data-slot="start-saving"
    :aria-label="card.title"
    class="flex flex-col rounded-lg border border-hairline bg-surface py-1"
  >
    <h2 class="px-3 pt-3 pb-2 text-[15px] font-medium">{{ card.title }}</h2>
    <ul>
      <ListRow
        v-for="option in card.options"
        :key="option.id"
        as="li"
        class="border-x-0 border-b-hairline last:border-b-transparent"
        :data-option="option.id"
      >
        <div class="flex items-center gap-4">
          <div class="flex min-w-0 flex-1 flex-col gap-1">
            <span class="text-sm font-medium">{{ option.title }}</span>
            <span class="text-[13px] text-muted-foreground">{{ option.description }}</span>
          </div>
          <Button as-child size="sm">
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
        </div>
      </ListRow>
    </ul>
  </section>
</template>
