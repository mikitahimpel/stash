<script setup lang="ts">
import { useAtomSet } from "@effect/atom-vue";
import { LogOut } from "@lucide/vue";
import Button from "@stash/web-ui/button";
import { ref } from "vue";
import { useRouter } from "vue-router";
import * as AuthAtoms from "./auth-atoms.ts";
import * as Routes from "./routes.ts";

const router = useRouter();
const logout = useAtomSet(() => AuthAtoms.logout, { mode: "promiseExit" });
const pending = ref(false);

// The login page follows whatever the api answers: on `Unauthorized` the session was already gone.
const signOut = async () => {
  pending.value = true;
  try {
    await logout(undefined);
    await router.push({ name: Routes.login });
  } finally {
    pending.value = false;
  }
};
</script>

<template>
  <!-- An icon key, so it fits the app header next to search and the theme toggle on phones. -->
  <Button as-child variant="ghost" size="icon">
    <button
      type="button"
      aria-label="Sign out"
      title="Sign out"
      :disabled="pending"
      @click="signOut"
    >
      <LogOut aria-hidden="true" />
    </button>
  </Button>
</template>
