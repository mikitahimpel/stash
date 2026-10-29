<script setup lang="ts">
import { injectRegistry, useAtom, useAtomSet, useAtomValue } from "@effect/atom-vue";
import { Plus } from "@lucide/vue";
import type * as Devices from "@stash/contracts-api/devices";
import type * as Device from "@stash/contracts-domain/device";
import * as Theme from "@stash/web-platform/theme";
import Button from "@stash/web-ui/button";
import EmptyState from "@stash/web-ui/empty-state";
import ErrorState from "@stash/web-ui/error-state";
import ListRow from "@stash/web-ui/list-row";
import PageHeader from "@stash/web-ui/page-header";
import SectionHeader from "@stash/web-ui/section-header";
import SegmentedControl from "@stash/web-ui/segmented-control";
import type { SegmentedControlOption } from "@stash/web-ui/segmented-control-option";
import Skeleton from "@stash/web-ui/skeleton";
import { useDelayedLoading } from "@stash/web-ui/use-delayed-loading";
import * as DateTime from "effect/DateTime";
import * as Exit from "effect/Exit";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import { computed, ref } from "vue";
import AddDeviceDialog from "./add-device-dialog.vue";
import NewTokenDialog from "./new-token-dialog.vue";
import RevokeTokenDialog from "./revoke-token-dialog.vue";
import * as SettingsAtoms from "./settings-atoms.ts";
import * as SettingsRows from "./settings-rows.ts";
import * as ThemeAtoms from "./theme-atoms.ts";

// Appearance: the theme preference, through the platform `Theme` service.
const themeOptions: ReadonlyArray<SegmentedControlOption<Theme.Preference>> = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];
const theme = useAtomValue(() => ThemeAtoms.state);
const setPreference = useAtomSet(() => ThemeAtoms.setPreference);
const preference = computed({
  get: () =>
    AsyncResult.isSuccess(theme.value) ? theme.value.value.preference : Theme.defaultPreference,
  set: (value) => setPreference(value),
});

const registry = injectRegistry();
const rows = useAtomValue(() => SettingsAtoms.rows);
// The skeleton only shows on a first load that takes a while: the rows stay cached between visits.
const loading = useDelayedLoading(() => AsyncResult.isInitial(rows.value));
const retry = () => SettingsAtoms.refresh(registry);
const now = DateTime.nowUnsafe();
// Section counts, once the rows have loaded.
const counts = computed(() =>
  AsyncResult.isSuccess(rows.value)
    ? {
        devices: { count: rows.value.value.devices.length },
        tokens: { count: rows.value.value.tokens.length },
      }
    : { devices: {}, tokens: {} },
);
// The counts under the title, once the rows have loaded.
const subtitle = computed(() => {
  if (!AsyncResult.isSuccess(rows.value)) return {};
  const { devices, tokens } = rows.value.value;
  const active = tokens.filter((row) => row.token.revokedAt === null).length;
  return {
    subtitle: `${devices.length} ${devices.length === 1 ? "device" : "devices"} · ${active} active ${active === 1 ? "token" : "tokens"}`,
  };
});
const deviceNames = computed(
  () =>
    new Map(
      AsyncResult.isSuccess(rows.value)
        ? rows.value.value.devices.map((row) => [row.device.id, row.device.name])
        : [],
    ),
);

// Issuing: the plaintext lives only in the `issueToken` result, which is reset on dismiss.
const [issued, issue] = useAtom(() => SettingsAtoms.issueToken);
const issuing = computed(() => issued.value.waiting);
const issueError = computed(() =>
  AsyncResult.isFailure(issued.value) ? "Couldn't create the token. Try again." : undefined,
);
const created = computed(() =>
  AsyncResult.isSuccess(issued.value) && !issued.value.waiting ? issued.value.value : undefined,
);
const addingDevice = ref(false);
const addDevice = (device: Devices.RegisterDevice) => {
  issue({ _tag: "NewDevice", device });
};
const openAddDevice = (open: boolean) => {
  if (open) issue(Atom.Reset);
  addingDevice.value = open;
};
const newToken = (deviceId: Device.DeviceId) => issue({ _tag: "ExistingDevice", deviceId });

const copy = useAtomSet(() => SettingsAtoms.copyToken, { mode: "promiseExit" });
const copyState = ref<"idle" | "copied" | "failed">("idle");
const copyCreated = async () => {
  if (created.value === undefined) return;
  copyState.value = Exit.isSuccess(await copy(created.value.token)) ? "copied" : "failed";
};
const dismissCreated = () => {
  issue(Atom.Reset);
  addingDevice.value = false;
  copyState.value = "idle";
};

// Revoking asks for confirmation first.
const revoke = useAtomSet(() => SettingsAtoms.revokeToken, { mode: "promiseExit" });
const revoking = ref<SettingsRows.TokenRow>();
const revokePending = ref(false);
const revokeError = ref<string>();
const askRevoke = (row: SettingsRows.TokenRow) => {
  revokeError.value = undefined;
  revoking.value = row;
};
const confirmRevoke = async () => {
  if (revoking.value === undefined) return;
  revokePending.value = true;
  const exit = await revoke(revoking.value.token.id);
  revokePending.value = false;
  if (Exit.isSuccess(exit)) revoking.value = undefined;
  else revokeError.value = "Couldn't revoke the token. Try again.";
};
</script>

<template>
  <div class="grid gap-12">
    <PageHeader title="Settings" v-bind="subtitle" />

    <section aria-label="Appearance" class="grid gap-3">
      <SectionHeader title="Appearance" />
      <div class="flex flex-wrap items-center justify-between gap-3 px-3">
        <span class="text-sm">Theme</span>
        <SegmentedControl
          v-model="preference"
          :options="themeOptions"
          label="Theme"
          data-test="theme"
        />
      </div>
    </section>

    <section aria-label="Devices" class="grid gap-3">
      <SectionHeader title="Devices" v-bind="counts.devices">
        <template #actions>
          <Button as-child size="sm">
            <button type="button" data-test="add-device" @click="openAddDevice(true)">
              <Plus aria-hidden="true" />
              Add device
            </button>
          </Button>
        </template>
      </SectionHeader>

      <p v-if="!addingDevice && issueError" role="alert" class="px-3 text-sm text-destructive">
        {{ issueError }}
      </p>

      <div v-if="AsyncResult.isInitial(rows)" class="grid gap-2" aria-busy="true">
        <template v-if="loading">
          <Skeleton v-for="n in 2" :key="n" class="h-12 w-full" />
        </template>
      </div>
      <ErrorState
        v-else-if="AsyncResult.isFailure(rows)"
        title="Couldn't load devices"
        @retry="retry"
      />
      <EmptyState
        v-else-if="rows.value.devices.length === 0"
        title="No devices"
        description="Add a device to get a token for the extension, the Mac agent or a Shortcut."
      >
        <template #action>
          <Button as-child>
            <button type="button" @click="openAddDevice(true)">Add device</button>
          </Button>
        </template>
      </EmptyState>
      <ul v-else>
        <ListRow v-for="row in rows.value.devices" :key="row.device.id" as="li" data-test="device">
          <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span data-test="device-name" class="min-w-0 flex-1 truncate text-[15px]">
              {{ row.device.name }}
            </span>
            <span class="flex items-center gap-4 font-mono text-xs text-muted-foreground">
              <span>{{ SettingsRows.kindLabels[row.device.kind] }}</span>
              <span :title="row.lastSeen ? SettingsRows.formatDate(row.lastSeen) : undefined">
                {{ SettingsRows.formatLastSeen(row.lastSeen, now) }}
              </span>
            </span>
            <Button as-child variant="ghost" size="sm">
              <button
                type="button"
                data-test="new-token"
                :disabled="issuing"
                @click="newToken(row.device.id)"
              >
                New token
              </button>
            </Button>
          </div>
        </ListRow>
      </ul>
    </section>

    <section aria-label="API tokens" class="grid gap-3">
      <SectionHeader title="API tokens" v-bind="counts.tokens" />
      <template v-if="AsyncResult.isSuccess(rows)">
        <p v-if="rows.value.tokens.length === 0" class="px-3 text-sm text-muted-foreground">
          No tokens
        </p>
        <ul v-else>
          <ListRow v-for="row in rows.value.tokens" :key="row.token.id" as="li" data-test="token">
            <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span
                class="min-w-0 flex-1 truncate text-sm"
                :class="row.token.revokedAt !== null && 'text-muted-foreground'"
              >
                {{ row.deviceName ?? "Unknown device" }}
              </span>
              <span class="flex items-center gap-4 font-mono text-xs text-muted-foreground">
                <span>created {{ SettingsRows.formatDate(row.token.createdAt) }}</span>
                <span v-if="row.token.revokedAt !== null" data-test="revoked">
                  revoked {{ SettingsRows.formatDate(row.token.revokedAt) }}
                </span>
              </span>
              <Button v-if="row.token.revokedAt === null" as-child variant="ghost" size="sm">
                <button type="button" data-test="revoke-token" @click="askRevoke(row)">
                  Revoke
                </button>
              </Button>
            </div>
          </ListRow>
        </ul>
      </template>
    </section>

    <AddDeviceDialog
      :open="addingDevice && created === undefined"
      :pending="issuing"
      :error="addingDevice ? issueError : undefined"
      @update:open="openAddDevice"
      @submit="addDevice"
    />
    <NewTokenDialog
      :token="created"
      :device-name="created ? deviceNames.get(created.deviceId) : undefined"
      :copy="copyState"
      @copy="copyCreated"
      @dismiss="dismissCreated"
    />
    <RevokeTokenDialog
      :device-name="revoking ? (revoking.deviceName ?? 'This device') : undefined"
      :pending="revokePending"
      :error="revokeError"
      @confirm="confirmRevoke"
      @cancel="revoking = undefined"
    />
  </div>
</template>
