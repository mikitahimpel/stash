<script setup lang="ts">
import * as AtomVue from "@effect/atom-vue";
import type * as Link from "@stash/contracts-domain/link";
import Button from "@stash/web-ui/button";
import Kbd from "@stash/web-ui/kbd";
import * as Exit from "effect/Exit";
import { computed, ref } from "vue";
import LinkDeleteButton from "./link-delete-button.vue";
import * as LinkStatusActions from "./link-status-actions.ts";
import * as LinksAtoms from "./links-atoms.ts";

// A row's action bar: the status actions the link offers, then Delete.
// `afterRemove` is a prop, not an event (see `link-delete-button.vue`).
// `shortcuts` shows the key of each status action, where the Inbox keys apply.
const props = defineProps<{ link: Link.Link; afterRemove?: () => void; shortcuts?: boolean }>();

const setStatus = AtomVue.useAtomSet(() => LinksAtoms.setStatus, { mode: "promiseExit" });

const busy = ref(false);
const failed = ref(false);

const statusActions = computed(() => LinkStatusActions.available(props.link));

const changeStatus = async (status: Link.LinkStatus) => {
  busy.value = true;
  failed.value = false;
  const exit = await setStatus({ id: props.link.id, status });
  busy.value = false;
  failed.value = Exit.isFailure(exit);
};
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <Button v-for="action in statusActions" :key="action.status" as-child variant="ghost" size="sm">
      <button
        type="button"
        :disabled="busy"
        :data-action="action.status"
        :aria-keyshortcuts="shortcuts ? action.key : undefined"
        @click="changeStatus(action.status)"
      >
        <component :is="action.icon" aria-hidden="true" />
        {{ action.label }}
        <Kbd v-if="shortcuts" class="hidden sm:inline-flex">{{ action.key }}</Kbd>
      </button>
    </Button>
    <LinkDeleteButton
      v-model:busy="busy"
      v-model:failed="failed"
      :link="link"
      v-bind="afterRemove === undefined ? {} : { afterRemove }"
    />
    <span v-if="failed" role="alert" class="text-meta text-destructive">
      That didn't work. Try again.
    </span>
  </div>
</template>
