<script setup lang="ts">
import { useAtom, useAtomSet, useAtomValue } from "@effect/atom-vue";
import type * as SignIn from "@stash/contracts-domain/sign-in";
import Button from "@stash/web-ui/button";
import DeviceCode from "@stash/web-ui/device-code";
import ListRow from "@stash/web-ui/list-row";
import ListRowTitle from "@stash/web-ui/list-row-title";
import SectionHeader from "@stash/web-ui/section-header";
import * as Exit from "effect/Exit";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { computed, ref } from "vue";
import { useRoute } from "vue-router";
import ConfirmDialog from "../members/confirm-dialog.vue";
import * as SettingsRows from "../settings-rows.ts";
import * as SecurityAtoms from "./security-atoms.ts";

// Settings → Security (#178): passkeys, and the Google and GitHub accounts that sign this user in.
// The section appears with its data (it sits last but one, so nothing below it moves much).
const result = useAtomValue(() => SecurityAtoms.methods);
const methods = computed(() =>
  AsyncResult.isSuccess(result.value) ? result.value.value : undefined,
);
const total = computed(() => (methods.value ? SecurityAtoms.count(methods.value) : 0));
const lastOne = computed(() => total.value <= 1);
const hasGoogle = computed(() => methods.value?.accounts.some((a) => a.provider === "google"));
const hasGithub = computed(() => methods.value?.accounts.some((a) => a.provider === "github"));
const providerName = (provider: SignIn.AccountProvider) =>
  provider === "google" ? "Google" : "GitHub";

// The Google callback comes back here with `?signin=google_taken` when the account was not linked.
const route = useRoute();
const linkError = computed(() =>
  route.query["signin"] === "google_taken"
    ? "That Google account already signs in another member of this stash."
    : route.query["signin"] !== undefined
      ? "Google didn't link the account. Try again."
      : undefined,
);

const [added, add] = useAtom(() => SecurityAtoms.addPasskey);
const adding = computed(() => added.value.waiting);
const addText = computed(() => {
  if (!AsyncResult.isSuccess(added.value)) return undefined;
  switch (added.value.value) {
    case "exists":
      return "This device already has a passkey for your account.";
    case "unsupported":
      return "This browser can't make passkeys.";
    case "failed":
      return "Couldn't add the passkey. Try again.";
    default:
      return undefined;
  }
});

const [googleLink, linkGoogle] = useAtom(() => SecurityAtoms.linkGoogle);
const [github, linkGithub] = useAtom(() => SecurityAtoms.linkGithub);
const githubStep = computed(() =>
  AsyncResult.isSuccess(github.value) ? github.value.value : undefined,
);
const githubText = computed(() =>
  githubStep.value?.step === "taken"
    ? "That GitHub account already signs in someone in this stash."
    : githubStep.value?.step === "expired"
      ? "The code expired. Start again to link GitHub."
      : AsyncResult.isFailure(github.value) || AsyncResult.isFailure(googleLink.value)
        ? "Couldn't start linking. Try again."
        : undefined,
);

// Removing asks first.
const removePasskey = useAtomSet(() => SecurityAtoms.removePasskey, { mode: "promiseExit" });
const removeAccount = useAtomSet(() => SecurityAtoms.removeAccount, { mode: "promiseExit" });
type Asking =
  | { readonly kind: "passkey"; readonly passkey: SignIn.Passkey }
  | { readonly kind: "account"; readonly account: SignIn.LinkedAccount };
const asking = ref<Asking>();
const busy = ref(false);
const failed = ref<string>();
const ask = (value: Asking) => {
  failed.value = undefined;
  asking.value = value;
};
const confirm = async () => {
  const value = asking.value;
  if (value === undefined) return;
  busy.value = true;
  const exit =
    value.kind === "passkey"
      ? await removePasskey(value.passkey.id)
      : await removeAccount(value.account.id);
  busy.value = false;
  if (Exit.isSuccess(exit)) asking.value = undefined;
  else failed.value = "Couldn't remove it. It may be your last way to sign in.";
};
const dialog = computed(() => {
  const value = asking.value;
  if (value === undefined) return undefined;
  return value.kind === "passkey"
    ? {
        title: `Remove “${value.passkey.name}”?`,
        description: "That passkey stops signing you in. Your other ways to sign in stay.",
      }
    : {
        title: `Unlink ${providerName(value.account.provider)}?`,
        description: `${value.account.label ?? "This account"} stops signing you in. Your other ways to sign in stay.`,
      };
});
</script>

<template>
  <section
    v-if="methods"
    id="security"
    aria-label="Security"
    class="flex flex-col gap-1"
    data-test="security"
  >
    <SectionHeader title="Security" :count="total" />
    <p v-if="linkError ?? addText ?? githubText" role="alert" class="text-body text-destructive">
      {{ linkError ?? addText ?? githubText }}
    </p>
    <ul>
      <ListRow v-for="passkey in methods.passkeys" :key="passkey.id" as="li" data-test="passkey">
        <template #title>
          <ListRowTitle>{{ passkey.name }}</ListRowTitle>
        </template>
        <template #meta>
          <span>{{ passkey.synced ? "Synced passkey" : "Passkey on one device" }}</span>
          <span>added {{ SettingsRows.formatDate(passkey.createdAt) }}</span>
          <span v-if="passkey.lastUsedAt"
            >last used {{ SettingsRows.formatDate(passkey.lastUsedAt) }}</span
          >
        </template>
        <template #trailing>
          <Button as-child variant="ghost" size="sm">
            <button
              type="button"
              data-test="remove-passkey"
              :disabled="lastOne"
              :title="lastOne ? 'Your only way to sign in' : undefined"
              @click="ask({ kind: 'passkey', passkey })"
            >
              Remove
            </button>
          </Button>
        </template>
      </ListRow>
      <ListRow v-for="account in methods.accounts" :key="account.id" as="li" data-test="account">
        <template #title>
          <ListRowTitle>{{ providerName(account.provider) }}</ListRowTitle>
        </template>
        <template #meta>
          <span v-if="account.label">{{ account.label }}</span>
          <span v-if="account.fixed">the owner's account, set by this deployment</span>
          <span v-else-if="account.linkedAt"
            >linked {{ SettingsRows.formatDate(account.linkedAt) }}</span
          >
        </template>
        <template v-if="!account.fixed" #trailing>
          <Button as-child variant="ghost" size="sm">
            <button
              type="button"
              data-test="remove-account"
              :disabled="lastOne"
              :title="lastOne ? 'Your only way to sign in' : undefined"
              @click="ask({ kind: 'account', account })"
            >
              Unlink
            </button>
          </Button>
        </template>
      </ListRow>
      <ListRow as="li">
        <template #title><ListRowTitle>Add a way to sign in</ListRowTitle></template>
        <template #meta><span>a passkey on this device, or another account</span></template>
        <template #trailing>
          <div class="flex gap-2">
            <Button as-child variant="ghost" size="sm">
              <button type="button" data-test="add-passkey" :disabled="adding" @click="add()">
                Add passkey
              </button>
            </Button>
            <Button
              v-if="methods.providers.google && !hasGoogle"
              as-child
              variant="ghost"
              size="sm"
            >
              <button type="button" data-test="link-google" @click="linkGoogle()">
                Link Google
              </button>
            </Button>
            <Button
              v-if="methods.providers.github && !hasGithub"
              as-child
              variant="ghost"
              size="sm"
            >
              <button
                type="button"
                data-test="link-github"
                :disabled="githubStep?.step === 'waiting'"
                @click="linkGithub()"
              >
                Link GitHub
              </button>
            </Button>
          </div>
        </template>
      </ListRow>
    </ul>
    <div
      v-if="githubStep?.step === 'waiting'"
      class="flex max-w-sm flex-col gap-2"
      data-test="github-code"
    >
      <p class="text-body text-muted-foreground">Enter this code on GitHub to link the account.</p>
      <DeviceCode label="Your code">{{ githubStep.userCode }}</DeviceCode>
      <Button as-child size="md">
        <a :href="githubStep.verificationUri" target="_blank" rel="noopener noreferrer"
          >Open github.com/login/device</a
        >
      </Button>
    </div>

    <ConfirmDialog
      :open="dialog !== undefined"
      :title="dialog?.title ?? ''"
      :description="dialog?.description ?? ''"
      action="Remove"
      pending-action="Removing…"
      :pending="busy"
      :error="failed"
      @confirm="confirm"
      @cancel="asking = undefined"
    />
  </section>
</template>
