<script setup lang="ts">
import { useAtomSet } from "@effect/atom-vue";
import { TriangleAlert } from "@lucide/vue";
import type * as Device from "@stash/contracts-domain/device";
import * as Pairing from "@stash/contracts-domain/pairing";
import Button from "@stash/web-ui/button";
import EmptyState from "@stash/web-ui/empty-state";
import Input from "@stash/web-ui/input";
import PageHeader from "@stash/web-ui/page-header";
import Step from "@stash/web-ui/step";
import StepList from "@stash/web-ui/step-list";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { computed, ref } from "vue";
import { RouterLink } from "vue-router";
import * as ConnectAtoms from "../connect-atoms.ts";
import GuideWait from "../guides/guide-wait.vue";

// `/connect/extension?code=…`: the extension opened this tab with a one-time code. Approving
// registers its device and binds the code to it; the extension then claims its token by itself.
const props = defineProps<{ code: string | undefined }>();

const code = computed(() =>
  Schema.is(Pairing.PairingCode)(props.code) ? (props.code as Pairing.PairingCode) : undefined,
);
const name = ref("Zen");
const trimmed = computed(() => name.value.trim());
const valid = computed(() => trimmed.value.length > 0 && trimmed.value.length <= 100);
const pending = ref(false);
const error = ref<string>();
const device = ref<Device.Device>();
const approve = useAtomSet(() => ConnectAtoms.approveExtension, { mode: "promiseExit" });

const submit = async () => {
  if (code.value === undefined || !valid.value || pending.value) return;
  pending.value = true;
  error.value = undefined;
  const exit = await approve({ code: code.value, name: trimmed.value });
  pending.value = false;
  if (Exit.isSuccess(exit)) {
    device.value = exit.value;
    return;
  }
  const tag = Option.getOrUndefined(Option.map(Exit.findErrorOption(exit), (e) => e._tag));
  error.value =
    tag === "NotFound" || tag === "Conflict"
      ? "This code expired or was already used. Choose Connect in the extension again."
      : "Couldn't approve the extension. Try again.";
};
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader
      title="Connect Zen"
      subtitle="The extension asked to connect. Approve it only if you just chose Connect there."
    />
    <div v-if="code === undefined" role="alert">
      <EmptyState
        title="No pairing code"
        description="Open the extension's settings and choose Connect: it opens this page with a code."
      >
        <template #icon><TriangleAlert aria-hidden="true" /></template>
        <template #action>
          <Button as-child>
            <RouterLink :to="{ name: 'connect', query: { guide: 'extension' } }">
              Zen guide
            </RouterLink>
          </Button>
        </template>
      </EmptyState>
    </div>
    <StepList v-else>
      <Step :number="1" title="Name this browser and approve it" :done="device !== undefined">
        <p v-if="device !== undefined" data-test="approved" class="text-body text-muted-foreground">
          Approved “{{ device.name }}”. You can close this tab once it says Connected.
        </p>
        <form v-else class="flex min-w-0 items-center gap-2" @submit.prevent="submit">
          <Input
            :model-value="name"
            size="sm"
            class="min-w-0 flex-1 sm:max-w-sm"
            v-bind="{ name: 'name', maxlength: 100, 'aria-label': 'Device name' }"
            @update:model-value="(value) => (name = String(value ?? ''))"
          />
          <Button as-child variant="primary" size="sm">
            <button type="submit" data-action="approve" :disabled="!valid || pending">
              {{ pending ? "Approving…" : "Approve" }}
            </button>
          </Button>
        </form>
        <p v-if="error" role="alert" class="text-meta text-destructive">{{ error }}</p>
      </Step>
      <Step :number="2" title="The extension signs in">
        <GuideWait
          v-if="device !== undefined"
          :awaited="{ _tag: 'Device', deviceId: device.id }"
          waiting="Waiting for the extension…"
          contact="the extension signed in"
        />
        <p v-else class="text-body text-muted-foreground">
          It checks every few seconds and picks up its token once you approve.
        </p>
      </Step>
    </StepList>
  </div>
</template>
