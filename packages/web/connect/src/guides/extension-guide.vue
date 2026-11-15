<script setup lang="ts">
import { Download } from "@lucide/vue";
import * as PageOrigin from "@stash/web-platform/page-origin";
import Button from "@stash/web-ui/button";
import Step from "@stash/web-ui/step";
import StepList from "@stash/web-ui/step-list";
import * as ConnectValues from "../connect-values.ts";

// Zen / Firefox: download the extension from this deploy, install it, then pair it. Pairing opens
// `/connect/extension?code=…` here, which creates the device and waits for the extension.
const origin = PageOrigin.pageOrigin();
</script>

<template>
  <div class="flex min-w-0 flex-col gap-6" data-guide="extension">
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
        <p class="text-body text-muted-foreground">
          Open the file in Zen (or Firefox) and choose Add. If Zen saves it instead, drag it onto
          the Add-ons page (about:addons).
        </p>
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
