<script setup lang="ts">
import { useAtomValue } from "@effect/atom-vue";
import { Download } from "@lucide/vue";
import * as PageOrigin from "@stash/web-platform/page-origin";
import Button from "@stash/web-ui/button";
import Step from "@stash/web-ui/step";
import StepList from "@stash/web-ui/step-list";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { computed } from "vue";
import * as ConnectAtoms from "../connect-atoms.ts";
import * as ConnectValues from "../connect-values.ts";
import CopyValue from "./copy-value.vue";

// Zen / Firefox: download the extension from this deploy, install it, then pair it. Pairing opens
// `/connect/extension?code=…` here, which creates the device and waits for the extension. Release
// Firefox and Zen install only add-ons Mozilla signed, so an unsigned build gets other steps.
const origin = PageOrigin.pageOrigin();
const info = useAtomValue(() => ConnectAtoms.extensionSigned);
const signed = computed(() => AsyncResult.isSuccess(info.value) && info.value.value);
const debugging = "about:debugging#/runtime/this-firefox";
</script>

<template>
  <div
    class="flex min-w-0 flex-col gap-6"
    data-guide="extension"
    :data-signed="AsyncResult.isSuccess(info) ? String(signed) : undefined"
  >
    <StepList>
      <Step :number="1" title="Download the extension">
        <div>
          <Button as-child variant="primary" size="sm">
            <a :href="ConnectValues.extensionDownload(origin)" data-action="download">
              <Download aria-hidden="true" />
              Download for Zen
            </a>
          </Button>
        </div>
      </Step>
      <Step :number="2" title="Install it">
        <p v-if="signed" data-test="install" class="text-body text-muted-foreground">
          Open the file in Zen (or Firefox) and choose Add. If Zen saves it instead, drag it onto
          the Add-ons page (about:addons).
        </p>
        <template v-else>
          <p data-test="install" class="text-body text-muted-foreground">
            This file isn't signed by Mozilla, so Zen and Firefox won't install it the usual way.
            Load it as a temporary add-on instead: open this page in Zen, choose Load Temporary
            Add-on… and pick the file. It stays until Zen restarts; load it again after a restart.
          </p>
          <CopyValue label="Debugging page" :value="debugging" />
          <p class="text-body text-muted-foreground">
            In Firefox Developer Edition or Nightly you can install it for good: set
            <span class="text-foreground">xpinstall.signatures.required</span> to false in
            about:config, then open the file and choose Add.
          </p>
        </template>
      </Step>
      <Step :number="3" title="Connect it">
        <p class="text-body text-muted-foreground">
          Open the extension's settings (about:addons → Stash → Preferences) and choose Connect. A
          Stash tab opens to approve it, and the extension signs in by itself: nothing to copy.
        </p>
      </Step>
    </StepList>
  </div>
</template>
