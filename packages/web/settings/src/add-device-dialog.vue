<script setup lang="ts">
import type * as Devices from "@stash/contracts-api/devices";
import type * as Device from "@stash/contracts-domain/device";
import Button from "@stash/web-ui/button";
import Dialog from "@stash/web-ui/dialog";
import DialogContent from "@stash/web-ui/dialog-content";
import DialogDescription from "@stash/web-ui/dialog-description";
import DialogFooter from "@stash/web-ui/dialog-footer";
import DialogHeader from "@stash/web-ui/dialog-header";
import DialogTitle from "@stash/web-ui/dialog-title";
import Input from "@stash/web-ui/input";
import { computed, ref, watch } from "vue";
import * as DeviceRows from "./device-rows.ts";

const props = defineProps<{ pending: boolean; error: string | undefined }>();
const open = defineModel<boolean>("open", { required: true });
const emit = defineEmits<{ submit: [device: Devices.RegisterDevice] }>();

const kinds = Object.entries(DeviceRows.kindLabels) as ReadonlyArray<[Device.DeviceKind, string]>;
const name = ref("");
const kind = ref<Device.DeviceKind>("zen");
const trimmed = computed(() => name.value.trim());
const valid = computed(() => trimmed.value.length > 0 && trimmed.value.length <= 100);

watch(open, (isOpen) => {
  if (isOpen) {
    name.value = "";
    kind.value = "zen";
  }
});

const submit = () => {
  if (valid.value && !props.pending) emit("submit", { name: trimmed.value, kind: kind.value });
};
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent>
      <form class="grid gap-4" @submit.prevent="submit">
        <DialogHeader>
          <DialogTitle>Add device</DialogTitle>
          <DialogDescription>
            The device gets its own API token. You can revoke it at any time.
          </DialogDescription>
        </DialogHeader>
        <label class="grid gap-2 text-sm font-medium">
          Name
          <Input
            :model-value="name"
            name="name"
            placeholder="Work laptop"
            maxlength="100"
            @update:model-value="(value) => (name = String(value ?? ''))"
          />
        </label>
        <label class="grid gap-2 text-sm font-medium">
          Kind
          <select
            v-model="kind"
            name="kind"
            class="h-10 rounded-md border border-input bg-transparent px-3 text-base sm:h-9 md:text-sm"
          >
            <option v-for="[value, label] in kinds" :key="value" :value="value">
              {{ label }}
            </option>
          </select>
        </label>
        <p v-if="error" role="alert" class="text-sm text-destructive">{{ error }}</p>
        <DialogFooter>
          <Button type="submit" :disabled="!valid || pending">
            {{ pending ? "Creating…" : "Create device and token" }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
