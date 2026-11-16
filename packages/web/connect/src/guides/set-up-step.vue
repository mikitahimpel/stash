<script setup lang="ts">
import { useAtomSet } from "@effect/atom-vue";
import type * as Device from "@stash/contracts-domain/device";
import Button from "@stash/web-ui/button";
import Input from "@stash/web-ui/input";
import Step from "@stash/web-ui/step";
import * as Exit from "effect/Exit";
import type * as Redacted from "effect/Redacted";
import { computed, ref } from "vue";
import * as ConnectAtoms from "../connect-atoms.ts";

// The first step of the iPhone and Mac guides: name the device, then create it (and its token).
const props = defineProps<{
  number: number;
  title: string;
  kind: Device.DeviceKind;
  defaultName: string;
  withToken: boolean;
  /** The button: `Create this iPhone`, `Create a token for this Mac`. */
  action: string;
  /** Set once the step is done: the device it created. */
  device: Device.Device | undefined;
}>();
const emit = defineEmits<{
  done: [device: Device.Device, token: Redacted.Redacted<string> | undefined];
}>();

const name = ref(props.defaultName);
const trimmed = computed(() => name.value.trim());
const valid = computed(() => trimmed.value.length > 0 && trimmed.value.length <= 100);
const pending = ref(false);
const error = ref<string>();
const setUp = useAtomSet(() => ConnectAtoms.setUp, { mode: "promiseExit" });

const create = async () => {
  if (!valid.value || pending.value) return;
  pending.value = true;
  error.value = undefined;
  const exit = await setUp({ kind: props.kind, name: trimmed.value, withToken: props.withToken });
  pending.value = false;
  if (Exit.isSuccess(exit)) emit("done", exit.value.device, exit.value.token);
  else error.value = "Couldn't create the device. Try again.";
};
</script>

<template>
  <Step :number="number" :title="title" :done="device !== undefined">
    <p v-if="device !== undefined" data-test="created" class="text-body text-muted-foreground">
      Created “{{ device.name }}”.
    </p>
    <form v-else class="flex min-w-0 flex-wrap items-center gap-2" @submit.prevent="create">
      <Input
        :model-value="name"
        size="sm"
        class="min-w-0 flex-1"
        v-bind="{ name: 'name', maxlength: 100, 'aria-label': 'Device name' }"
        @update:model-value="(value) => (name = String(value ?? ''))"
      />
      <Button as-child variant="primary" size="sm">
        <button type="submit" data-action="create" :disabled="!valid || pending">
          {{ pending ? "Creating…" : action }}
        </button>
      </Button>
    </form>
    <p v-if="error" role="alert" class="text-meta text-destructive">{{ error }}</p>
  </Step>
</template>
