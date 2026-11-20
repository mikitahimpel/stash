<script setup lang="ts">
import { injectRegistry, useAtom, useAtomSet, useAtomValue } from "@effect/atom-vue";
import type * as Device from "@stash/contracts-domain/device";
import ConnectSection from "@stash/web-connect/connect-section";
import type * as ConnectStatus from "@stash/web-connect/connect-status";
import * as Theme from "@stash/web-platform/theme";
import Button from "@stash/web-ui/button";
import ErrorState from "@stash/web-ui/error-state";
import ListRow from "@stash/web-ui/list-row";
import ListRowTitle from "@stash/web-ui/list-row-title";
import PageHeader from "@stash/web-ui/page-header";
import SectionHeader from "@stash/web-ui/section-header";
import SegmentedControl from "@stash/web-ui/segmented-control";
import type { SegmentedControlOption } from "@stash/web-ui/segmented-control-option";
import ListRowSkeleton from "@stash/web-ui/list-row-skeleton";
import { useDelayedLoading } from "@stash/web-ui/use-delayed-loading";
import * as DateTime from "effect/DateTime";
import * as Exit from "effect/Exit";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import { computed, ref } from "vue";
import MembersSection from "./members/members-section.vue";
import SecuritySection from "./security/security-section.vue";
import NewTokenDialog from "./new-token-dialog.vue";
import RevokeTokenDialog from "./revoke-token-dialog.vue";
import * as SettingsAtoms from "./settings-atoms.ts";
import * as SettingsRows from "./settings-rows.ts";
import * as ThemeAtoms from "./theme-atoms.ts";

// One page, its sections in this order: Devices & connections (the sources with their guides,
// from `@stash/web-connect`, then the devices they registered), API tokens, Appearance, and
// then what only some users have (`members-section`: the AI summaries line, and for the owner
// the Members).
defineProps<{
  /** The guide open in place (`/settings?guide=iphone`), if any. */
  guide?: ConnectStatus.Source | undefined;
}>();

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
// The skeleton only shows on a first load that takes a while (the rows stay cached between
// visits), and then for long enough not to flash. Its rows are the list's own rows.
const loading = useDelayedLoading(() => AsyncResult.isInitial(rows.value));
// The sections under the devices wait for the rows: how many devices there are decides where
// they start, so they come in at their place instead of moving there.
const settled = computed(() => !loading.value && !AsyncResult.isInitial(rows.value));
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
  // The line keeps its place until the rows are there.
  if (!AsyncResult.isSuccess(rows.value)) return "";
  const { devices, tokens } = rows.value.value;
  const active = tokens.filter((row) => row.token.revokedAt === null).length;
  if (devices.length === 0 && active === 0) return "";
  return `${devices.length} ${devices.length === 1 ? "device" : "devices"} · ${active} active ${active === 1 ? "token" : "tokens"}`;
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
const newToken = (deviceId: Device.DeviceId) => issue({ _tag: "ExistingDevice", deviceId });

const copy = useAtomSet(() => SettingsAtoms.copyToken, { mode: "promiseExit" });
const copyState = ref<"idle" | "copied" | "failed">("idle");
const copyCreated = async () => {
  if (created.value === undefined) return;
  copyState.value = Exit.isSuccess(await copy(created.value.token)) ? "copied" : "failed";
};
const dismissCreated = () => {
  issue(Atom.Reset);
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

// Section headers, row text and the controls at the end of rows all sit on the content edges:
// ListRow reaches past them only with its background.
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader title="Settings" :subtitle="subtitle" />

    <ConnectSection :guide="guide">
      <SectionHeader title="Devices" as="h3" v-bind="counts.devices" />

      <p v-if="issueError" role="alert" class="text-body text-destructive">
        {{ issueError }}
      </p>

      <!-- Before the skeleton shows (a fast load never shows it) the rows already hold their
           place. -->
      <ul
        v-if="loading || AsyncResult.isInitial(rows)"
        aria-busy="true"
        :data-state="loading ? 'loading' : undefined"
        :class="loading ? undefined : 'invisible'"
      >
        <ListRowSkeleton v-for="n in 2" :key="n" as="li" trailing />
      </ul>
      <ErrorState
        v-else-if="AsyncResult.isFailure(rows)"
        title="Couldn't load devices"
        @retry="retry"
      />
      <ul v-else-if="rows.value.devices.length === 0">
        <ListRow as="li" data-test="no-devices">
          <template #title><ListRowTitle muted>No devices yet</ListRowTitle></template>
        </ListRow>
      </ul>
      <ul v-else>
        <ListRow v-for="row in rows.value.devices" :key="row.device.id" as="li" data-test="device">
          <template #title>
            <ListRowTitle v-bind="{ 'data-test': 'device-name' }">{{
              row.device.name
            }}</ListRowTitle>
          </template>
          <template #meta>
            <span>{{ SettingsRows.kindLabels[row.device.kind] }}</span>
            <span :title="row.lastSeen ? SettingsRows.formatDate(row.lastSeen) : undefined">
              {{ SettingsRows.formatLastSeen(row.lastSeen, now) }}
            </span>
          </template>
          <template #trailing>
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
          </template>
        </ListRow>
      </ul>
    </ConnectSection>

    <section v-if="settled" aria-label="API tokens" class="flex flex-col gap-1">
      <SectionHeader title="API tokens" v-bind="counts.tokens" />
      <template v-if="AsyncResult.isSuccess(rows)">
        <ul v-if="rows.value.tokens.length === 0">
          <ListRow as="li" data-test="no-tokens">
            <template #title><ListRowTitle muted>No tokens yet</ListRowTitle></template>
          </ListRow>
        </ul>
        <ul v-else>
          <ListRow v-for="row in rows.value.tokens" :key="row.token.id" as="li" data-test="token">
            <template #title>
              <ListRowTitle :muted="row.token.revokedAt !== null">{{
                row.label ?? "Unknown device"
              }}</ListRowTitle>
            </template>
            <template #meta>
              <span>created {{ SettingsRows.formatDate(row.token.createdAt) }}</span>
              <span v-if="row.token.revokedAt !== null" data-test="revoked">
                revoked {{ SettingsRows.formatDate(row.token.revokedAt) }}
              </span>
            </template>
            <template v-if="row.token.revokedAt === null" #trailing>
              <Button as-child variant="ghost" size="sm">
                <button type="button" data-test="revoke-token" @click="askRevoke(row)">
                  Revoke
                </button>
              </Button>
            </template>
          </ListRow>
        </ul>
      </template>
    </section>

    <section v-if="settled" aria-label="Appearance" class="flex flex-col gap-1">
      <SectionHeader title="Appearance" />
      <ul>
        <ListRow as="li">
          <template #title><ListRowTitle>Theme</ListRowTitle></template>
          <template #trailing>
            <SegmentedControl
              v-model="preference"
              :options="themeOptions"
              label="Theme"
              size="sm"
              data-test="theme"
            />
          </template>
        </ListRow>
      </ul>
    </section>

    <SecuritySection v-if="settled" />

    <MembersSection v-if="settled" />

    <NewTokenDialog
      :token="created"
      :device-name="
        created && created.deviceId !== null ? deviceNames.get(created.deviceId) : undefined
      "
      :copy="copyState"
      @copy="copyCreated"
      @dismiss="dismissCreated"
    />
    <RevokeTokenDialog
      :device-name="revoking ? (revoking.label ?? 'This device') : undefined"
      :pending="revokePending"
      :error="revokeError"
      @confirm="confirmRevoke"
      @cancel="revoking = undefined"
    />
  </div>
</template>
