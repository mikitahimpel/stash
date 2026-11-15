<script setup lang="ts">
import type * as Device from "@stash/contracts-domain/device";
import * as PageOrigin from "@stash/web-platform/page-origin";
import Step from "@stash/web-ui/step";
import StepList from "@stash/web-ui/step-list";
import * as Redacted from "effect/Redacted";
import { ref } from "vue";
import * as ConnectValues from "../connect-values.ts";
import CopyValue from "./copy-value.vue";
import GuideWait from "./guide-wait.vue";
import SetUpStep from "./set-up-step.vue";

// Mac: the agent that reads the iPhone's Safari tabs from iCloud and reports them as "Open now".
// One command installs it with this Mac's token.
const origin = PageOrigin.pageOrigin();
const device = ref<Device.Device>();
const token = ref<string>();
const done = (created: Device.Device, createdToken: Redacted.Redacted<string> | undefined) => {
  device.value = created;
  token.value = createdToken === undefined ? undefined : Redacted.value(createdToken);
};
</script>

<template>
  <div class="flex min-w-0 flex-col gap-6" data-guide="mac">
    <StepList>
      <SetUpStep
        :number="1"
        title="Create a token for this Mac"
        kind="mac-agent"
        default-name="Mac"
        :with-token="true"
        action="Create token"
        :device="device"
        @done="done"
      />
      <Step :number="2" title="Install the agent">
        <p class="text-body text-muted-foreground">
          The Mac needs Node 24 or newer (<span class="text-foreground">brew install node</span>)
          and Safari tabs syncing in iCloud. Paste this in Terminal:
        </p>
        <CopyValue
          v-if="token !== undefined"
          label="Install command"
          :value="ConnectValues.macInstallCommand(origin, token)"
        />
        <p v-else class="text-meta text-muted-foreground">Create the token first.</p>
        <p class="text-body text-muted-foreground">
          The installer prints the Node binary to add under System Settings → Privacy & Security →
          Full Disk Access, so the agent can read the iCloud tabs.
        </p>
      </Step>
      <Step :number="3" title="Wait for the first check-in">
        <GuideWait
          v-if="device !== undefined"
          :awaited="{ _tag: 'Device', deviceId: device.id }"
          waiting="Waiting for the agent to check in…"
          contact="the Mac agent checked in"
        />
        <p v-else class="text-body text-muted-foreground">
          The agent reports the iPhone's open tabs every few minutes. They show up in Open now.
        </p>
      </Step>
    </StepList>
    <div class="flex min-w-0 flex-col gap-2">
      <p class="text-label">Uninstall</p>
      <CopyValue label="Uninstall command" :value="ConnectValues.macUninstallCommand(origin)" />
    </div>
  </div>
</template>
