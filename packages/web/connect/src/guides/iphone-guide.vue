<script setup lang="ts">
import { useAtomSet } from "@effect/atom-vue";
import type * as Device from "@stash/contracts-domain/device";
import * as PageOrigin from "@stash/web-platform/page-origin";
import { Globe, Share } from "@lucide/vue";
import Button from "@stash/web-ui/button";
import Card from "@stash/web-ui/card";
import Disclosure from "@stash/web-ui/disclosure";
import ListRow from "@stash/web-ui/list-row";
import ListRowTitle from "@stash/web-ui/list-row-title";
import Step from "@stash/web-ui/step";
import StepList from "@stash/web-ui/step-list";
import * as Exit from "effect/Exit";
import * as Redacted from "effect/Redacted";
import { ref } from "vue";
import * as ConnectAtoms from "../connect-atoms.ts";
import * as ConnectValues from "../connect-values.ts";
import CopyValue from "./copy-value.vue";
import GuideWait from "./guide-wait.vue";
import SetUpStep from "./set-up-step.vue";

// iPhone / iPad: a two-action Shortcut in the Share sheet that opens `/save` in Safari. Advanced:
// a Shortcut that posts with a token, and a bookmarklet for any browser.
const origin = PageOrigin.pageOrigin();
const shortcutLabel =
  "The Shortcut: Receive URLs from Share Sheet, then Open URLs with the address below and the Shortcut Input";
const device = ref<Device.Device>();

const createToken = useAtomSet(() => ConnectAtoms.createToken, { mode: "promiseExit" });
const token = ref<string>();
const tokenPending = ref(false);
const tokenError = ref<string>();
const makeToken = async () => {
  if (device.value === undefined || tokenPending.value) return;
  tokenPending.value = true;
  tokenError.value = undefined;
  const exit = await createToken(device.value.id);
  tokenPending.value = false;
  if (Exit.isSuccess(exit)) token.value = Redacted.value(exit.value);
  else tokenError.value = "Couldn't create the token. Try again.";
};
</script>

<template>
  <div class="flex min-w-0 flex-col gap-6" data-guide="iphone">
    <StepList>
      <SetUpStep
        :number="1"
        title="Create a device for this iPhone"
        kind="ios"
        default-name="iPhone"
        :with-token="false"
        action="Create device"
        :device="device"
        @done="(created) => (device = created)"
      />
      <Step :number="2" title="Make the Shortcut">
        <template v-if="device !== undefined">
          <p class="text-body text-muted-foreground">
            In <span class="text-foreground">Shortcuts</span>, tap +, name it “Save to Stash”, and
            in its details turn on <span class="text-foreground">Show in Share Sheet</span>. Then
            add these two actions:
          </p>
          <Card data-test="shortcut-mock" v-bind="{ role: 'img', 'aria-label': shortcutLabel }">
            <ul>
              <ListRow as="li">
                <template #leading><Share :size="16" aria-hidden="true" /></template>
                <template #title
                  ><ListRowTitle>Receive URLs from Share Sheet</ListRowTitle></template
                >
                <template #meta><span>URLs and Safari web pages</span></template>
              </ListRow>
              <ListRow as="li">
                <template #leading><Globe :size="16" aria-hidden="true" /></template>
                <template #title><ListRowTitle>Open URLs</ListRowTitle></template>
                <template #meta><span>the address below, then Shortcut Input</span></template>
              </ListRow>
            </ul>
          </Card>
          <p class="text-body text-muted-foreground">
            In Open URLs, paste this address, then add the
            <span class="text-foreground">Shortcut Input</span> variable right after “url=”:
          </p>
          <CopyValue label="Shortcut URL" :value="ConnectValues.shortcutUrl(origin, device.id)" />
        </template>
        <p v-else class="text-body text-muted-foreground">Create the device first.</p>
      </Step>
      <Step :number="3" title="Share a page to Stash">
        <p class="text-body text-muted-foreground">
          In Safari, tap Share and pick “Save to Stash”. Safari opens Stash and saves the link. The
          first time, sign in there.
        </p>
        <GuideWait
          v-if="device !== undefined"
          :awaited="{ _tag: 'Device', deviceId: device.id }"
          waiting="Waiting for your first save…"
          contact="this iPhone got in touch"
        />
      </Step>
    </StepList>

    <Disclosure summary="Advanced: save without opening Safari, or from any browser">
      <div class="flex min-w-0 flex-col gap-2">
        <p class="text-label">Token Shortcut</p>
        <p class="text-body text-muted-foreground">
          The Shortcut posts the link itself: Get URLs from Input, then Get Contents of URL with
          method POST, header Authorization and a JSON body with a “url” field. The token stays in
          the Shortcut, so don't share it.
        </p>
        <template v-if="token !== undefined">
          <CopyValue label="API address" :value="ConnectValues.saveLinkEndpoint(origin)" />
          <CopyValue label="Authorization header" :value="ConnectValues.bearer(token)" />
        </template>
        <div v-else class="flex min-w-0 flex-col gap-2">
          <div>
            <Button as-child variant="secondary" size="sm">
              <button
                type="button"
                data-action="create-token"
                :disabled="device === undefined || tokenPending"
                @click="makeToken"
              >
                {{ tokenPending ? "Creating…" : "Create a token for this iPhone" }}
              </button>
            </Button>
          </div>
          <p v-if="device === undefined" class="text-meta text-muted-foreground">
            Create the device in step 1 first.
          </p>
          <p v-if="tokenError" role="alert" class="text-meta text-destructive">{{ tokenError }}</p>
        </div>
      </div>
      <div class="flex min-w-0 flex-col gap-2">
        <p class="text-label">Bookmarklet</p>
        <p class="text-body text-muted-foreground">
          Add a bookmark with this address. Tapping it saves the page you're on, in any browser
          signed in to Stash.
        </p>
        <CopyValue label="Bookmarklet" :value="ConnectValues.bookmarklet(origin)" />
      </div>
    </Disclosure>
  </div>
</template>
