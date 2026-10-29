<script setup lang="ts">
import { useAtomSet } from "@effect/atom-vue";
import { CircleUser, LogOut, Settings } from "@lucide/vue";
import Button from "@stash/web-ui/button";
import DropdownMenu from "@stash/web-ui/dropdown-menu";
import DropdownMenuContent from "@stash/web-ui/dropdown-menu-content";
import DropdownMenuItem from "@stash/web-ui/dropdown-menu-item";
import DropdownMenuSeparator from "@stash/web-ui/dropdown-menu-separator";
import DropdownMenuTrigger from "@stash/web-ui/dropdown-menu-trigger";
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
  <!-- The account key at the end of the app header: Settings and Sign out. -->
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button as-child variant="ghost" size="icon">
        <button type="button" aria-label="Account" title="Account" data-test="account-menu">
          <CircleUser aria-hidden="true" />
        </button>
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="min-w-40">
      <DropdownMenuItem @select="router.push({ name: 'settings' })">
        <Settings aria-hidden="true" />
        Settings
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem :disabled="pending" data-test="sign-out" @select="signOut">
        <LogOut aria-hidden="true" />
        Sign out
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
