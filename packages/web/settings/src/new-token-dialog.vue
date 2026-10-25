<script setup lang="ts">
import type * as ApiToken from "@stash/contracts-domain/api-token";
import Button from "@stash/web-ui/button";
import Dialog from "@stash/web-ui/dialog";
import DialogContent from "@stash/web-ui/dialog-content";
import DialogDescription from "@stash/web-ui/dialog-description";
import DialogFooter from "@stash/web-ui/dialog-footer";
import DialogHeader from "@stash/web-ui/dialog-header";
import DialogTitle from "@stash/web-ui/dialog-title";
import * as Redacted from "effect/Redacted";

defineProps<{
  token: ApiToken.CreatedApiToken | undefined;
  copy: "idle" | "copied" | "failed";
}>();
const emit = defineEmits<{ copy: []; dismiss: [] }>();
</script>

<template>
  <Dialog :open="token !== undefined" @update:open="(open) => open || emit('dismiss')">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>New API token</DialogTitle>
        <DialogDescription>
          Copy it now and paste it into the device. It is shown only this once.
        </DialogDescription>
      </DialogHeader>
      <code
        v-if="token"
        data-test="token-plaintext"
        class="rounded-md border bg-muted px-3 py-2 font-mono text-sm break-all select-all"
      >
        {{ Redacted.value(token.token) }}
      </code>
      <p v-if="copy === 'failed'" role="alert" class="text-sm text-destructive">
        Couldn't copy. Select the token and copy it by hand.
      </p>
      <DialogFooter>
        <Button variant="outline" data-test="copy-token" @click="emit('copy')">
          {{ copy === "copied" ? "Copied" : "Copy" }}
        </Button>
        <Button data-test="dismiss-token" @click="emit('dismiss')">Done</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
