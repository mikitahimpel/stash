<script setup lang="ts">
import { useAtom, useAtomSet, useAtomValue } from "@effect/atom-vue";
import type * as Invite from "@stash/contracts-domain/invite";
import Button from "@stash/web-ui/button";
import CenteredScreen from "@stash/web-ui/centered-screen";
import DeviceCode from "@stash/web-ui/device-code";
import Wordmark from "@stash/web-ui/wordmark";
import * as Exit from "effect/Exit";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import { computed, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import * as AuthAtoms from "./auth-atoms.ts";
import * as DeviceLoginAtoms from "./device-login-atoms.ts";
import * as Routes from "./routes.ts";

// What the page reads when it has no invite to check.
const noInvite = Atom.make(AsyncResult.initial<DeviceLoginAtoms.InviteState>());

const props = defineProps<{
  /**
   * The token of the invite link the page was opened with (`/invite/<token>`); `null` for a link
   * that has not the shape of one. Not set on the plain login page.
   */
  invite?: Invite.InviteToken | null;
}>();

// An invite link says what it is before anyone signs in: an open invite, or one that no longer
// works. Signing in is offered either way: someone with an account needs no invite.
const inviteCheck = useAtomValue(() =>
  props.invite ? DeviceLoginAtoms.invite(props.invite) : noInvite,
);
const inviteState = computed(() => {
  if (props.invite === undefined) return undefined;
  if (props.invite === null) return "closed";
  if (AsyncResult.isSuccess(inviteCheck.value)) return inviteCheck.value.value.state;
  // Asking failed (no connection): say nothing wrong, the sign-in itself will tell.
  return AsyncResult.isFailure(inviteCheck.value) ? "unknown" : "checking";
});

const route = useRoute();
const router = useRouter();
const [result, start] = useAtom(() => DeviceLoginAtoms.deviceLogin);
const setSignedOut = useAtomSet(() => AuthAtoms.signedOut);

const login = computed(() =>
  AsyncResult.isSuccess(result.value) ? result.value.value : undefined,
);
const waiting = computed(() => (login.value?.step === "waiting" ? login.value : undefined));
const starting = computed(() => AsyncResult.isInitial(result.value) && result.value.waiting);
// A failed start or poll (no answer, or an unexpected one): the page shows why, with a Retry.
const failure = computed(() =>
  AsyncResult.isFailure(result.value)
    ? DeviceLoginAtoms.failureText(result.value.cause)
    : undefined,
);

// Signed in: the session cookie is set, and the guard lets the app through to the page the user
// wanted.
watch(login, (value) => {
  if (value?.step !== "complete") return;
  setSignedOut(false);
  void router.push(Routes.returnTo(route.query));
});

// The countdown ticks once a second while a code is shown.
const now = ref(Date.now());
const ticker = setInterval(() => (now.value = Date.now()), 1000);
onUnmounted(() => clearInterval(ticker));
const remaining = computed(() =>
  waiting.value ? DeviceLoginAtoms.remaining(waiting.value.expiresAt, now.value) : "",
);

const copy = useAtomSet(() => DeviceLoginAtoms.copyCode, { mode: "promiseExit" });
const copyState = ref<"idle" | "copied" | "failed">("idle");
const copyCode = async () => {
  if (!waiting.value) return;
  copyState.value = Exit.isSuccess(await copy(waiting.value.userCode)) ? "copied" : "failed";
};

const restart = () => {
  copyState.value = "idle";
  start(props.invite ?? undefined);
};

const ended = computed(() => {
  switch (login.value?.step) {
    case "expired":
      return { message: "The code expired before it was entered.", action: "Get a new code" };
    case "denied":
      return { message: "The sign-in was declined on GitHub.", action: "Try again" };
    case "notAllowed":
      return {
        message:
          inviteState.value === undefined
            ? "This GitHub account has no account in this stash. Ask its owner for an invite link."
            : "This invite link no longer works. Ask for a new one.",
        action: "Use another account",
      };
    default:
      return failure.value === undefined
        ? undefined
        : {
            message: "Couldn't reach stash. Check the connection.",
            detail: failure.value,
            action: "Retry",
          };
  }
});
</script>

<template>
  <CenteredScreen>
    <Wordmark as="h1" size="xl" />

    <!-- GitHub Device Flow: no redirect or popup, so it works in the home-screen app, and the code
         can be entered on any device. -->
    <section
      v-if="waiting"
      class="flex w-full max-w-sm flex-col items-center gap-4"
      data-test="device-code"
    >
      <p class="text-body text-muted-foreground">
        Enter this code on GitHub, on this or any other device.
      </p>
      <div class="flex w-full items-center gap-2">
        <DeviceCode label="Your code" v-bind="{ 'data-test': 'user-code' }">{{
          waiting.userCode
        }}</DeviceCode>
        <Button as-child size="lg">
          <button type="button" data-test="copy-code" @click="copyCode">
            {{ copyState === "copied" ? "Copied" : "Copy" }}
          </button>
        </Button>
      </div>
      <p v-if="copyState === 'failed'" role="alert" class="text-body text-destructive">
        Couldn't copy. Select the code and copy it by hand.
      </p>
      <Button as-child variant="primary" size="lg" class="w-full">
        <a
          :href="waiting.verificationUri"
          target="_blank"
          rel="noopener noreferrer"
          data-test="verification-link"
          >Open github.com/login/device</a
        >
      </Button>
      <p class="text-meta text-muted-foreground" aria-live="polite">
        waiting for GitHub · expires in <span data-test="countdown">{{ remaining }}</span>
      </p>
    </section>

    <section
      v-else-if="login?.step === 'notConfigured'"
      class="flex max-w-sm flex-col items-center gap-2"
      data-test="not-configured"
    >
      <p class="text-body">Sign-in isn't configured on this deployment yet.</p>
      <p class="text-meta text-muted-foreground">
        the GitHub login needs to be set up before anyone can sign in
      </p>
    </section>

    <section v-else-if="ended" class="flex max-w-sm flex-col items-center gap-4" data-test="ended">
      <p role="alert" class="text-body">{{ ended.message }}</p>
      <p
        v-if="'detail' in ended"
        class="text-meta break-all text-muted-foreground"
        data-test="error-detail"
      >
        {{ ended.detail }}
      </p>
      <Button as-child variant="primary" size="lg">
        <button type="button" data-test="restart" @click="restart">{{ ended.action }}</button>
      </Button>
    </section>

    <template v-else-if="login?.step !== 'complete'">
      <!-- The line keeps its place while the invite is checked, so the button does not move. -->
      <p
        v-if="inviteState !== undefined"
        class="max-w-sm text-center text-body"
        :class="inviteState === 'checking' || inviteState === 'unknown' ? 'invisible' : undefined"
        :role="inviteState === 'closed' ? 'alert' : undefined"
        data-test="invite"
        :data-state="inviteState"
      >
        {{
          inviteState === "closed"
            ? "This invite link no longer works. If you already have an account, sign in."
            : "You're invited to this stash. Sign in with GitHub to join."
        }}
      </p>
      <Button as-child variant="primary" size="lg">
        <button type="button" :disabled="starting" data-test="sign-in" @click="restart">
          Sign in with GitHub
        </button>
      </Button>
      <p class="text-meta text-muted-foreground">you'll get a code to enter on github.com</p>
    </template>

    <p v-else class="text-body text-muted-foreground" data-test="signed-in">
      Signed in. Opening stash…
    </p>
  </CenteredScreen>
</template>
