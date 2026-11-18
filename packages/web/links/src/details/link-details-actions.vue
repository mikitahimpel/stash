<script setup lang="ts">
import * as AtomVue from "@effect/atom-vue";
import type * as Link from "@stash/contracts-domain/link";
import ActionBar from "@stash/web-ui/action-bar";
import Button from "@stash/web-ui/button";
import Kbd from "@stash/web-ui/kbd";
import * as Exit from "effect/Exit";
import { computed, onMounted, ref } from "vue";
import * as LinkStatusActions from "../link-status-actions.ts";
import * as LinksAtoms from "../links-atoms.ts";
import * as InboxShortcuts from "../list/inbox-shortcuts.ts";

// The status actions of a link on its own page: Mark seen, Mark done, Archive as secondary
// buttons, with the Inbox's keys (S, D, E). On phones they are the bar at the bottom of the screen.
const props = defineProps<{ link: Link.Link }>();

const setStatus = AtomVue.useAtomSet(() => LinksAtoms.setStatus, { mode: "promiseExit" });

const busy = ref(false);
const failed = ref(false);

const actions = computed(() => LinkStatusActions.available(props.link));

const changeStatus = async (status: Link.LinkStatus) => {
  if (busy.value || !LinkStatusActions.applies(props.link, status)) return;
  busy.value = true;
  failed.value = false;
  const exit = await setStatus({ id: props.link.id, status });
  busy.value = false;
  failed.value = Exit.isFailure(exit);
};

const commands: Partial<Record<InboxShortcuts.Command, Link.LinkStatus>> = {
  seen: "seen",
  done: "done",
  archive: "archived",
};
const listen = AtomVue.useAtomSet(() => InboxShortcuts.listen);
// Runs until the component unmounts, which disposes the atom and stops listening.
onMounted(() =>
  listen({
    run: (command) => {
      const status = commands[command];
      if (status !== undefined) void changeStatus(status);
    },
  }),
);
</script>

<template>
  <!-- On phones the bar is fixed, so the wrapper steps aside and leaves no gap of its own. -->
  <div class="flex flex-col gap-2 max-sm:contents">
    <ActionBar label="Link actions">
      <Button v-for="action in actions" :key="action.status" as-child variant="secondary" size="sm">
        <button
          type="button"
          :disabled="busy"
          :data-action="action.status"
          :aria-keyshortcuts="action.key"
          @click="changeStatus(action.status)"
        >
          <component :is="action.icon" aria-hidden="true" class="max-sm:hidden" />
          {{ action.label }}
          <Kbd class="hidden sm:inline-flex">{{ action.key }}</Kbd>
        </button>
      </Button>
    </ActionBar>
    <p v-if="failed" role="alert" class="text-meta text-destructive">
      That didn't work. Try again.
    </p>
  </div>
</template>
