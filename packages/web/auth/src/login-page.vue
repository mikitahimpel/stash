<script setup lang="ts">
import { useAtom, useAtomSet } from "@effect/atom-vue";
import Button from "@stash/web-ui/button";
import * as Exit from "effect/Exit";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { computed, onUnmounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import * as DeviceLoginAtoms from "./device-login-atoms.ts";

const router = useRouter();
const [result, start] = useAtom(() => DeviceLoginAtoms.deviceLogin);

const login = computed(() =>
  AsyncResult.isSuccess(result.value) ? result.value.value : undefined,
);
const waiting = computed(() => (login.value?.step === "waiting" ? login.value : undefined));
const starting = computed(() => AsyncResult.isInitial(result.value) && result.value.waiting);
const failed = computed(() => AsyncResult.isFailure(result.value));

// Signed in: the session cookie is set, and the guard lets the app through.
watch(login, (value) => {
  if (value?.step === "complete") void router.push("/");
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
  start(undefined);
};

const ended = computed(() => {
  switch (login.value?.step) {
    case "expired":
      return { message: "The code expired before it was entered.", action: "Get a new code" };
    case "denied":
      return { message: "The sign-in was declined on GitHub.", action: "Try again" };
    case "notAllowed":
      return {
        message: "This GitHub account can't sign in to this stash.",
        action: "Use another account",
      };
    default:
      return failed.value
        ? { message: "Couldn't reach stash. Check the connection.", action: "Try again" }
        : undefined;
  }
});
</script>

<template>
  <main
    class="flex min-h-dvh flex-col items-center justify-center gap-6 bg-background px-4 text-foreground"
  >
    <h1 class="text-[15px] font-semibold tracking-tight">stash</h1>

    <!-- GitHub Device Flow: no redirect or popup, so it works in the home-screen app, and the code
         can be entered on any device. -->
    <section
      v-if="waiting"
      class="flex w-full max-w-sm flex-col items-center gap-4"
      data-test="device-code"
    >
      <p class="text-center text-sm text-muted-foreground">
        Enter this code on GitHub, on this or any other device.
      </p>
      <div class="flex w-full items-center gap-2">
        <output
          class="tactile-sunken flex h-14 flex-1 items-center justify-center rounded-lg font-mono text-2xl font-medium tracking-[0.2em] select-all"
          aria-label="Your code"
          data-test="user-code"
          >{{ waiting.userCode }}</output
        >
        <Button as-child>
          <button type="button" class="h-14 sm:h-14" data-test="copy-code" @click="copyCode">
            {{ copyState === "copied" ? "Copied" : "Copy" }}
          </button>
        </Button>
      </div>
      <p v-if="copyState === 'failed'" role="alert" class="text-sm text-destructive">
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
      <p class="font-mono text-xs text-muted-foreground" aria-live="polite">
        waiting for GitHub · expires in <span data-test="countdown">{{ remaining }}</span>
      </p>
    </section>

    <section
      v-else-if="ended"
      class="flex max-w-sm flex-col items-center gap-4 text-center"
      data-test="ended"
    >
      <p role="alert" class="text-sm">{{ ended.message }}</p>
      <Button as-child variant="primary" size="lg">
        <button type="button" data-test="restart" @click="restart">{{ ended.action }}</button>
      </Button>
    </section>

    <template v-else-if="login?.step !== 'complete'">
      <Button as-child variant="primary" size="lg">
        <button type="button" :disabled="starting" data-test="sign-in" @click="restart">
          Sign in with GitHub
        </button>
      </Button>
      <p class="font-mono text-xs text-muted-foreground">
        you'll get a code to enter on github.com
      </p>
    </template>
  </main>
</template>
