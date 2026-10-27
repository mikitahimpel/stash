<script setup lang="ts">
import type * as ApiToken from "@stash/contracts-domain/api-token";
import Button from "@stash/web-ui/button";
import Dialog from "@stash/web-ui/dialog";
import DialogContent from "@stash/web-ui/dialog-content";
import DialogDescription from "@stash/web-ui/dialog-description";
import DialogFooter from "@stash/web-ui/dialog-footer";
import DialogHeader from "@stash/web-ui/dialog-header";
import DialogTitle from "@stash/web-ui/dialog-title";
import Input from "@stash/web-ui/input";
import * as Redacted from "effect/Redacted";

defineProps<{
  token: ApiToken.CreatedApiToken | undefined;
  deviceName: string | undefined;
  copy: "idle" | "copied" | "failed";
}>();
const emit = defineEmits<{ copy: []; dismiss: [] }>();
</script>

<template>
  <Dialog :open="token !== undefined" @update:open="(open) => open || emit('dismiss')">
    <DialogContent>
      <DialogHeader>
        <DialogTitle
          >New API token<template v-if="deviceName"> · {{ deviceName }}</template></DialogTitle
        >
        <DialogDescription data-test="token-warning">
          Shown only once. Copy it now: after you close this dialog it can't be shown again.
        </DialogDescription>
      </DialogHeader>
      <div v-if="token" class="flex gap-2">
        <Input
          :model-value="Redacted.value(token.token)"
          class="font-mono text-xs"
          v-bind="{
            readonly: true,
            'aria-label': 'API token',
            spellcheck: false,
            'data-test': 'token-plaintext',
          }"
        />
        <Button as-child>
          <button type="button" data-test="copy-token" @click="emit('copy')">
            {{ copy === "copied" ? "Copied" : "Copy" }}
          </button>
        </Button>
      </div>
      <p v-if="copy === 'failed'" role="alert" class="text-sm text-destructive">
        Couldn't copy. Select the token and copy it by hand.
      </p>
      <DialogFooter>
        <Button as-child variant="primary">
          <button type="button" data-test="dismiss-token" @click="emit('dismiss')">Done</button>
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
