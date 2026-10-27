<script setup lang="ts">
import Button from "@stash/web-ui/button";
import Dialog from "@stash/web-ui/dialog";
import DialogClose from "@stash/web-ui/dialog-close";
import DialogContent from "@stash/web-ui/dialog-content";
import DialogDescription from "@stash/web-ui/dialog-description";
import DialogFooter from "@stash/web-ui/dialog-footer";
import DialogHeader from "@stash/web-ui/dialog-header";
import DialogTitle from "@stash/web-ui/dialog-title";

defineProps<{ deviceName: string | undefined; pending: boolean; error: string | undefined }>();
const emit = defineEmits<{ confirm: []; cancel: [] }>();
</script>

<template>
  <Dialog :open="deviceName !== undefined" @update:open="(open) => open || emit('cancel')">
    <DialogContent v-bind="{ role: 'alertdialog' }">
      <DialogHeader>
        <DialogTitle>Revoke token?</DialogTitle>
        <DialogDescription>
          {{ deviceName }} can no longer reach Stash with this token. This can't be undone.
        </DialogDescription>
      </DialogHeader>
      <p v-if="error" role="alert" class="text-sm text-destructive">{{ error }}</p>
      <DialogFooter>
        <DialogClose as-child>
          <Button data-test="cancel-revoke">Cancel</Button>
        </DialogClose>
        <Button as-child variant="destructive">
          <button
            type="button"
            data-test="confirm-revoke"
            :disabled="pending"
            @click="emit('confirm')"
          >
            {{ pending ? "Revoking…" : "Revoke" }}
          </button>
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
