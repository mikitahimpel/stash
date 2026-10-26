<script setup lang="ts">
import { useAtom, useAtomSet, useAtomValue } from "@effect/atom-vue";
import { KeyRound, MonitorSmartphone, Plus } from "@lucide/vue";
import type * as Devices from "@stash/contracts-api/devices";
import type * as ApiToken from "@stash/contracts-domain/api-token";
import Badge from "@stash/web-ui/badge";
import Button from "@stash/web-ui/button";
import Card from "@stash/web-ui/card";
import CardContent from "@stash/web-ui/card-content";
import CardDescription from "@stash/web-ui/card-description";
import CardHeader from "@stash/web-ui/card-header";
import CardTitle from "@stash/web-ui/card-title";
import EmptyState from "@stash/web-ui/empty-state";
import Skeleton from "@stash/web-ui/skeleton";
import * as Exit from "effect/Exit";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import { computed, ref } from "vue";
import AddDeviceDialog from "./add-device-dialog.vue";
import * as DeviceRows from "./device-rows.ts";
import NewTokenDialog from "./new-token-dialog.vue";
import RevokeTokenDialog from "./revoke-token-dialog.vue";
import * as SettingsAtoms from "./settings-atoms.ts";

const rows = useAtomValue(() => SettingsAtoms.rows);

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
const newToken = (row: DeviceRows.DeviceRow) =>
  issue({ _tag: "ExistingDevice", deviceId: row.device.id });

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
const revoking = ref<{ readonly token: ApiToken.ApiTokenInfo; readonly deviceName: string }>();
const revokePending = ref(false);
const revokeError = ref<string>();
const askRevoke = (row: DeviceRows.DeviceRow, token: ApiToken.ApiTokenInfo) => {
  revokeError.value = undefined;
  revoking.value = { token, deviceName: row.device.name };
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
  <section class="grid gap-6">
    <div class="flex items-center justify-between gap-4">
      <div>
        <h1 class="text-2xl font-semibold">Settings</h1>
        <p class="text-sm text-muted-foreground">Devices and the API tokens they use.</p>
      </div>
      <Button as-child>
        <button type="button" data-test="add-device" @click="openAddDevice(true)">
          <Plus aria-hidden="true" />
          Add device
        </button>
      </Button>
    </div>

    <p v-if="!addingDevice && issueError" role="alert" class="text-sm text-destructive">
      {{ issueError }}
    </p>

    <div v-if="AsyncResult.isInitial(rows)" class="grid gap-3" aria-busy="true">
      <Skeleton v-for="n in 2" :key="n" class="h-28 w-full" />
    </div>
    <p v-else-if="AsyncResult.isFailure(rows)" role="alert" class="text-sm text-destructive">
      Couldn't load devices. Reload the page to try again.
    </p>
    <EmptyState
      v-else-if="rows.value.length === 0"
      title="No devices yet"
      description="Add the Zen extension, the iPhone Shortcut or the Mac agent as a device to give it an API token."
    >
      <template #icon><MonitorSmartphone /></template>
    </EmptyState>
    <ul v-else class="grid gap-3">
      <li v-for="row in rows.value" :key="row.device.id" data-test="device">
        <Card>
          <CardHeader class="flex flex-row items-start justify-between gap-4">
            <div class="grid gap-1">
              <CardTitle class="flex items-center gap-2">
                {{ row.device.name }}
                <Badge variant="secondary">{{ DeviceRows.kindLabels[row.device.kind] }}</Badge>
              </CardTitle>
              <CardDescription>
                Added {{ DeviceRows.formatDate(row.device.createdAt) }}
              </CardDescription>
            </div>
            <Button as-child variant="outline" size="sm">
              <button
                type="button"
                data-test="new-token"
                :disabled="issuing"
                @click="newToken(row)"
              >
                <KeyRound aria-hidden="true" />
                New token
              </button>
            </Button>
          </CardHeader>
          <CardContent>
            <p v-if="row.tokens.length === 0" class="text-sm text-muted-foreground">No tokens.</p>
            <ul v-else class="grid gap-2">
              <li
                v-for="token in row.tokens"
                :key="token.id"
                data-test="token"
                class="flex items-center justify-between gap-4 text-sm"
              >
                <span class="flex items-center gap-2">
                  <Badge v-if="token.revokedAt === null">Active</Badge>
                  <Badge v-else variant="outline">Revoked</Badge>
                  <span class="text-muted-foreground">
                    Created {{ DeviceRows.formatDate(token.createdAt) }}
                    <template v-if="token.revokedAt !== null">
                      · revoked {{ DeviceRows.formatDate(token.revokedAt) }}
                    </template>
                  </span>
                </span>
                <Button v-if="token.revokedAt === null" as-child variant="ghost" size="sm">
                  <button type="button" data-test="revoke-token" @click="askRevoke(row, token)">
                    Revoke
                  </button>
                </Button>
              </li>
            </ul>
          </CardContent>
        </Card>
      </li>
    </ul>

    <AddDeviceDialog
      :open="addingDevice && created === undefined"
      :pending="issuing"
      :error="addingDevice ? issueError : undefined"
      @update:open="openAddDevice"
      @submit="addDevice"
    />
    <NewTokenDialog
      :token="created"
      :copy="copyState"
      @copy="copyCreated"
      @dismiss="dismissCreated"
    />
    <RevokeTokenDialog
      :device-name="revoking?.deviceName"
      :pending="revokePending"
      :error="revokeError"
      @confirm="confirmRevoke"
      @cancel="revoking = undefined"
    />
  </section>
</template>
