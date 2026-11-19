<script setup lang="ts">
import Button from "@stash/web-ui/button";
import Dialog from "@stash/web-ui/dialog";
import DialogClose from "@stash/web-ui/dialog-close";
import DialogContent from "@stash/web-ui/dialog-content";
import DialogDescription from "@stash/web-ui/dialog-description";
import DialogFooter from "@stash/web-ui/dialog-footer";
import DialogHeader from "@stash/web-ui/dialog-header";
import DialogTitle from "@stash/web-ui/dialog-title";

// Asks before something that can't be undone: removing a member, revoking an invite.
defineProps<{
  open: boolean;
  title: string;
  description: string;
  /** The destructive button, and what it says while the request runs. */
  action: string;
  pendingAction: string;
  pending: boolean;
  error: string | undefined;
}>();
const emit = defineEmits<{ confirm: []; cancel: [] }>();
</script>

<template>
  <Dialog :open="open" @update:open="(value) => value || emit('cancel')">
    <DialogContent v-bind="{ role: 'alertdialog' }">
      <DialogHeader>
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogDescription data-test="confirm-description">{{ description }}</DialogDescription>
      </DialogHeader>
      <p v-if="error" role="alert" class="text-body text-destructive">{{ error }}</p>
      <DialogFooter>
        <DialogClose as-child>
          <Button data-test="cancel">Cancel</Button>
        </DialogClose>
        <Button as-child variant="destructive">
          <button type="button" data-test="confirm" :disabled="pending" @click="emit('confirm')">
            {{ pending ? pendingAction : action }}
          </button>
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
