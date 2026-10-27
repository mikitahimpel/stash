<script setup lang="ts">
import Button from "@stash/web-ui/button";
import Dialog from "@stash/web-ui/dialog";
import DialogClose from "@stash/web-ui/dialog-close";
import DialogContent from "@stash/web-ui/dialog-content";
import DialogDescription from "@stash/web-ui/dialog-description";
import DialogFooter from "@stash/web-ui/dialog-footer";
import DialogHeader from "@stash/web-ui/dialog-header";
import DialogTitle from "@stash/web-ui/dialog-title";
import * as OpenTabsView from "./open-tabs-view.ts";

defineProps<{ open: boolean; count: number }>();
const emit = defineEmits<{ confirm: []; cancel: [] }>();
</script>

<template>
  <Dialog :open="open" @update:open="(next) => next || emit('cancel')">
    <DialogContent v-bind="{ role: 'alertdialog' }">
      <DialogHeader>
        <DialogTitle>Archive {{ count }} {{ count === 1 ? "tab" : "tabs" }}?</DialogTitle>
        <DialogDescription>
          Open longer than {{ OpenTabsView.oldAfterDays }} days. Saved as links, closed on their
          devices.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <DialogClose as-child>
          <Button data-action="cancel-archive-all">Cancel</Button>
        </DialogClose>
        <Button as-child variant="primary">
          <button type="button" data-action="confirm-archive-all" @click="emit('confirm')">
            Archive {{ count }}
          </button>
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
