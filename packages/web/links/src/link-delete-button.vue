<script setup lang="ts">
import * as AtomVue from "@effect/atom-vue";
import { Trash2 } from "@lucide/vue";
import type * as Link from "@stash/contracts-domain/link";
import Button from "@stash/web-ui/button";
import Dialog from "@stash/web-ui/dialog";
import DialogClose from "@stash/web-ui/dialog-close";
import DialogContent from "@stash/web-ui/dialog-content";
import DialogDescription from "@stash/web-ui/dialog-description";
import DialogFooter from "@stash/web-ui/dialog-footer";
import DialogHeader from "@stash/web-ui/dialog-header";
import DialogTitle from "@stash/web-ui/dialog-title";
import * as Exit from "effect/Exit";
import { ref } from "vue";
import * as LinkDisplay from "./link-display.ts";
import * as LinksAtoms from "./links-atoms.ts";

// Delete, behind a dialog that asks first. `busy` and `failed` are shared with the actions beside
// it: they are disabled while the delete runs, and whoever holds `failed` says so.
// `afterRemove` is a prop, not an event: the delete refreshes the links queries, which can unmount
// this component before the delete resolves, and Vue drops events of unmounted components.
const props = withDefaults(
  defineProps<{
    link: Link.Link;
    afterRemove?: () => void;
    /** `ghost` in a row's action bar, `destructive` on the link's own page. */
    variant?: "ghost" | "destructive";
  }>(),
  { variant: "ghost" },
);
const busy = defineModel<boolean>("busy", { default: false });
const failed = defineModel<boolean>("failed", { default: false });

const remove = AtomVue.useAtomSet(() => LinksAtoms.remove, { mode: "promiseExit" });
const confirming = ref(false);

const confirmRemove = async () => {
  confirming.value = false;
  busy.value = true;
  failed.value = false;
  const exit = await remove(props.link.id);
  busy.value = false;
  failed.value = Exit.isFailure(exit);
  if (Exit.isSuccess(exit)) props.afterRemove?.();
};
</script>

<template>
  <Dialog v-model:open="confirming">
    <Button as-child :variant="variant" size="sm">
      <button type="button" :disabled="busy" data-action="delete" @click="confirming = true">
        <Trash2 aria-hidden="true" />
        Delete
      </button>
    </Button>
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
        <Button as-child variant="destructive">
          <button type="button" data-action="confirm-delete" @click="confirmRemove">Delete</button>
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
