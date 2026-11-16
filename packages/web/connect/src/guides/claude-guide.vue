<script setup lang="ts">
import { useAtomValue } from "@effect/atom-vue";
import Step from "@stash/web-ui/step";
import StepList from "@stash/web-ui/step-list";
import * as DateTime from "effect/DateTime";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { computed } from "vue";
import * as ConnectAtoms from "../connect-atoms.ts";
import CopyValue from "./copy-value.vue";
import GuideWait from "./guide-wait.vue";

// Claude: add this deploy's MCP server as a custom connector. Signing in mints its token, so the
// guide only waits for Claude to use it.
const info = useAtomValue(() => ConnectAtoms.info);
const mcpUrl = computed(() =>
  AsyncResult.isSuccess(info.value) ? info.value.value.mcpUrl : undefined,
);
// Claude counts as connected once it uses a token after the guide opened.
const since = DateTime.nowUnsafe();
</script>

<template>
  <div class="flex min-w-0 flex-col gap-6" data-guide="claude">
    <StepList>
      <Step :number="1" title="Copy the connector URL">
        <CopyValue v-if="typeof mcpUrl === 'string'" label="Connector URL" :value="mcpUrl" />
        <p v-else-if="mcpUrl === null" role="alert" class="text-body text-muted-foreground">
          This deploy has no MCP server configured (MCP_ORIGIN is unset on the api).
        </p>
        <p v-else-if="AsyncResult.isFailure(info)" role="alert" class="text-body text-destructive">
          Couldn't load the connector URL. Reload the page to try again.
        </p>
        <p v-else aria-busy="true" class="text-body text-muted-foreground">Loading…</p>
      </Step>
      <Step :number="2" title="Add it to Claude">
        <p class="text-body text-muted-foreground">
          In Claude, open Settings → Connectors → Add custom connector, paste the URL and choose
          Add. Leave the OAuth fields empty. It shows up on your phone too.
        </p>
      </Step>
      <Step :number="3" title="Sign in and try it">
        <p class="text-body text-muted-foreground">
          Choose Connect, approve, and sign in with GitHub. Then ask Claude: “Save
          https://example.com to Stash”.
        </p>
        <GuideWait
          :awaited="{ _tag: 'Claude', since }"
          waiting="Waiting for Claude to use Stash…"
        />
      </Step>
    </StepList>
  </div>
</template>
