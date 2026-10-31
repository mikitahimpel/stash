<script setup lang="ts">
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
  /** A page of the docs, which `apps/web` serves. Without it the action adds a device in Settings. */
  readonly doc?: string;
}

const zen = { id: "zen", title: "Zen extension", action: "Add device" };

const cards: Readonly<
  Record<typeof props.scenario, { title: string; options: ReadonlyArray<Option> }>
> = {
  links: {
    title: "Start saving",
    options: [
      { ...zen, description: "Save the current tab with a hotkey" },
      {
        id: "iphone",
        title: "iPhone",
        description: "Save from the Share sheet with a Shortcut",
        action: "Set up",
        doc: "/docs/ios-shortcut.md",
      },
      {
        id: "claude",
        title: "Claude",
        description: "Save and search from a chat with the MCP connector",
        action: "Connect",
        doc: "/docs/mcp-connector.md",
      },
    ],
  },
  tabs: {
    title: "Add a device",
    options: [
      { ...zen, description: "Reports the tabs open in Zen" },
      {
        id: "iphone",
        title: "iPhone",
        description: "A Mac agent reports its Safari tabs from iCloud",
        action: "Add device",
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
        class="border-x-0 last:border-b-transparent"
        :data-option="option.id"
      >
        <div class="flex items-center gap-4">
          <div class="flex min-w-0 flex-1 flex-col gap-1">
            <span class="text-sm font-medium">{{ option.title }}</span>
            <span class="text-[13px] text-muted-foreground">{{ option.description }}</span>
          </div>
          <Button as-child size="sm">
            <a v-if="option.doc" :href="option.doc" target="_blank" rel="noopener noreferrer">
              {{ option.action }}
            </a>
            <RouterLink v-else :to="{ name: 'settings', query: { add: 'device' } }">
              {{ option.action }}
            </RouterLink>
          </Button>
        </div>
      </ListRow>
    </ul>
  </section>
</template>
