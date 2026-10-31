<script setup lang="ts">
import { useAtomSet, useAtomValue } from "@effect/atom-vue";
import { CircleUser, LogOut } from "@lucide/vue";
import Button from "@stash/web-ui/button";
import DropdownMenu from "@stash/web-ui/dropdown-menu";
import DropdownMenuContent from "@stash/web-ui/dropdown-menu-content";
import DropdownMenuItem from "@stash/web-ui/dropdown-menu-item";
import DropdownMenuSeparator from "@stash/web-ui/dropdown-menu-separator";
import DropdownMenuTrigger from "@stash/web-ui/dropdown-menu-trigger";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import * as AuthAtoms from "./auth-atoms.ts";
import * as Routes from "./routes.ts";

const props = defineProps<{
  /** Something in the menu that needs a look, such as `offline`: a dot on the button, and its name. */
  alert?: string | undefined;
}>();
defineSlots<{ default?: () => unknown }>();

const router = useRouter();

const me = useAtomValue(() => AuthAtoms.me);
// The avatar: the first letter of the login, or an icon until it is known.
const initial = computed(() => {
  if (!AsyncResult.isSuccess(me.value) || me.value.value.kind !== "user") return undefined;
  return me.value.value.login?.charAt(0).toUpperCase() || undefined;
});

const name = computed(() => (props.alert ? `Account (${props.alert})` : "Account"));

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
  <!-- The one control at the end of the app header. The default slot holds what else belongs in
       the menu, above Sign out. -->
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <!-- The negative margin puts the avatar, not the larger touch target, on the content edge. -->
      <Button as-child variant="ghost" size="icon" class="relative -mr-1.5 rounded-full sm:-mr-1">
        <button type="button" :aria-label="name" :title="name" data-test="account-menu">
          <span
            v-if="initial"
            aria-hidden="true"
            data-test="account-initial"
            class="flex size-7 items-center justify-center rounded-full bg-hairline text-[13px] font-medium text-foreground"
          >
            {{ initial }}
          </span>
          <CircleUser v-else aria-hidden="true" />
          <span
            v-if="alert"
            aria-hidden="true"
            data-test="account-attention"
            class="absolute top-1 right-1 size-2 rounded-full bg-signal"
          />
        </button>
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="min-w-48">
      <template v-if="$slots.default">
        <slot />
        <DropdownMenuSeparator />
      </template>
      <DropdownMenuItem :disabled="pending" data-test="sign-out" @select="signOut">
        <LogOut aria-hidden="true" />
        Sign out
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
