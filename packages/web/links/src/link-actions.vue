<script setup lang="ts">
import * as AtomVue from "@effect/atom-vue";
import { Archive, Check, Eye, Trash2 } from "@lucide/vue";
import type * as Link from "@stash/contracts-domain/link";
import Button from "@stash/web-ui/button";
import { buttonVariants } from "@stash/web-ui/button-variants";
import Dialog from "@stash/web-ui/dialog";
import DialogClose from "@stash/web-ui/dialog-close";
import DialogContent from "@stash/web-ui/dialog-content";
import DialogDescription from "@stash/web-ui/dialog-description";
import DialogFooter from "@stash/web-ui/dialog-footer";
import DialogHeader from "@stash/web-ui/dialog-header";
import DialogTitle from "@stash/web-ui/dialog-title";
import Kbd from "@stash/web-ui/kbd";
import * as Exit from "effect/Exit";
import { computed, ref } from "vue";
import * as LinkDisplay from "./link-display.ts";
import * as LinksAtoms from "./links-atoms.ts";

// `afterRemove` is a prop, not an event: the delete refreshes the links queries, which can unmount
// this component before the delete resolves, and Vue drops events of unmounted components.
// `shortcuts` shows the key of each status action, where the Inbox keys apply.
const props = defineProps<{ link: Link.Link; afterRemove?: () => void; shortcuts?: boolean }>();

const setStatus = AtomVue.useAtomSet(() => LinksAtoms.setStatus, { mode: "promiseExit" });
const remove = AtomVue.useAtomSet(() => LinksAtoms.remove, { mode: "promiseExit" });

// Native buttons in the kit's style, because `<Button>` doesn't declare `disabled` or `click`
// for strictTemplates.
const ghost = buttonVariants({ variant: "ghost", size: "sm" });

const busy = ref(false);
const failed = ref(false);
const confirming = ref(false);

const statusActions = computed(() =>
  (
    [
      {
        status: "seen",
        label: "Mark seen",
        key: "S",
        icon: Eye,
        when: props.link.status === "new",
      },
      { status: "done", label: "Done", key: "D", icon: Check, when: props.link.status !== "done" },
      {
        status: "archived",
        label: "Archive",
        key: "E",
        icon: Archive,
        when: props.link.status !== "archived",
      },
    ] as const
  ).filter((action) => action.when),
);

const run = async (action: () => Promise<Exit.Exit<unknown, unknown>>) => {
  busy.value = true;
  failed.value = false;
  const exit = await action();
  busy.value = false;
  failed.value = Exit.isFailure(exit);
  return Exit.isSuccess(exit);
};

const changeStatus = (status: Link.LinkStatus) =>
  run(() => setStatus({ id: props.link.id, status }));

const confirmRemove = async () => {
  confirming.value = false;
  if (await run(() => remove(props.link.id))) props.afterRemove?.();
};
</script>

<template>
  <div class="flex flex-wrap items-center gap-1">
    <button
      v-for="action in statusActions"
      :key="action.status"
      type="button"
      :class="ghost"
      :disabled="busy"
      :data-action="action.status"
      :aria-keyshortcuts="shortcuts ? action.key : undefined"
      @click="changeStatus(action.status)"
    >
      <component :is="action.icon" aria-hidden="true" />
      {{ action.label }}
      <Kbd v-if="shortcuts" class="hidden sm:inline-flex">{{ action.key }}</Kbd>
    </button>
    <Dialog v-model:open="confirming">
      <button
        type="button"
        :class="ghost"
        :disabled="busy"
        data-action="delete"
        @click="confirming = true"
      >
        <Trash2 aria-hidden="true" />
        Delete
      </button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this link?</DialogTitle>
          <DialogDescription>
            {{ LinkDisplay.title(link) }} is removed for good. This can't be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose as-child>
            <Button>Cancel</Button>
          </DialogClose>
          <button
            type="button"
            :class="buttonVariants({ variant: 'destructive' })"
            data-action="confirm-delete"
            @click="confirmRemove"
          >
            Delete
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <span v-if="failed" role="alert" class="text-[13px] text-destructive">
      That didn't work. Try again.
    </span>
  </div>
</template>
