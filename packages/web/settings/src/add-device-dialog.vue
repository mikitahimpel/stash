<script setup lang="ts">
import type * as Devices from "@stash/contracts-api/devices";
import type * as Device from "@stash/contracts-domain/device";
import Button from "@stash/web-ui/button";
import Dialog from "@stash/web-ui/dialog";
import DialogContent from "@stash/web-ui/dialog-content";
import DialogFooter from "@stash/web-ui/dialog-footer";
import DialogHeader from "@stash/web-ui/dialog-header";
import DialogTitle from "@stash/web-ui/dialog-title";
import Input from "@stash/web-ui/input";
import SegmentedControl from "@stash/web-ui/segmented-control";
import type { SegmentedControlOption } from "@stash/web-ui/segmented-control-option";
import { computed, ref, watch } from "vue";
import * as SettingsRows from "./settings-rows.ts";

const props = defineProps<{
  pending: boolean;
  error: string | undefined;
  /** The kind picked when it opens. Zen by default. */
  initialKind?: Device.DeviceKind | undefined;
}>();
const open = defineModel<boolean>("open", { required: true });
const emit = defineEmits<{ submit: [device: Devices.RegisterDevice] }>();

const kinds = Object.entries(SettingsRows.kindLabels).map(([value, label]) => ({
  value,
  label,
})) as ReadonlyArray<SegmentedControlOption<Device.DeviceKind>>;
const name = ref("");
const kind = ref<Device.DeviceKind>("zen");
const trimmed = computed(() => name.value.trim());
const valid = computed(() => trimmed.value.length > 0 && trimmed.value.length <= 100);

watch(open, (isOpen) => {
  if (isOpen) {
    name.value = "";
    kind.value = props.initialKind ?? "zen";
  }
});

const submit = () => {
  if (valid.value && !props.pending) emit("submit", { name: trimmed.value, kind: kind.value });
};
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent v-bind="{ 'aria-describedby': undefined }">
      <form class="grid gap-4" @submit.prevent="submit">
        <DialogHeader>
          <DialogTitle>Add device</DialogTitle>
        </DialogHeader>
        <label class="grid gap-1.5 text-[13px] font-medium">
          Name
          <Input
            :model-value="name"
            v-bind="{ name: 'name', placeholder: 'Work laptop', maxlength: 100 }"
            @update:model-value="(value) => (name = String(value ?? ''))"
          />
        </label>
        <div class="grid gap-1.5 text-[13px] font-medium">
          <span aria-hidden="true">Kind</span>
          <SegmentedControl v-model="kind" :options="kinds" label="Kind" class="w-full sm:w-fit" />
        </div>
        <p v-if="error" role="alert" class="text-sm text-destructive">{{ error }}</p>
        <DialogFooter>
          <Button as-child variant="primary">
            <button type="submit" :disabled="!valid || pending">
              {{ pending ? "Creating…" : "Create device and token" }}
            </button>
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
