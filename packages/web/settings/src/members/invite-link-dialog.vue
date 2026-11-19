<script setup lang="ts">
import Button from "@stash/web-ui/button";
import Dialog from "@stash/web-ui/dialog";
import DialogContent from "@stash/web-ui/dialog-content";
import DialogDescription from "@stash/web-ui/dialog-description";
import DialogFooter from "@stash/web-ui/dialog-footer";
import DialogHeader from "@stash/web-ui/dialog-header";
import DialogTitle from "@stash/web-ui/dialog-title";
import Input from "@stash/web-ui/input";

defineProps<{
  /** The invite link to send, while the dialog is open. */
  link: string | undefined;
  copy: "idle" | "copied" | "failed";
}>();
const emit = defineEmits<{ copy: []; dismiss: [] }>();
</script>

<template>
  <Dialog :open="link !== undefined" @update:open="(open) => open || emit('dismiss')">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Invite link</DialogTitle>
        <DialogDescription data-test="invite-warning">
          Send it to one person. It works once, for 7 days, and is shown only now: after you close
          this dialog it can't be shown again.
        </DialogDescription>
      </DialogHeader>
      <div v-if="link" class="flex gap-2">
        <Input
          :model-value="link"
          mono
          v-bind="{
            readonly: true,
            'aria-label': 'Invite link',
            spellcheck: false,
            'data-test': 'invite-link',
          }"
        />
        <Button as-child>
          <button type="button" data-test="copy-invite" @click="emit('copy')">
            {{ copy === "copied" ? "Copied" : "Copy" }}
          </button>
        </Button>
      </div>
      <p v-if="copy === 'failed'" role="alert" class="text-body text-destructive">
        Couldn't copy. Select the link and copy it by hand.
      </p>
      <DialogFooter>
        <Button as-child variant="primary">
          <button type="button" data-test="dismiss-invite" @click="emit('dismiss')">Done</button>
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
