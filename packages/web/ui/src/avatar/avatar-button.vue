<script setup lang="ts">
import { CircleUser } from "@lucide/vue";

// The account button: a 32px round avatar with the login's initial (the only round control),
// and an 8px accent dot when something needs attention. Attributes go to the <button>.
const props = defineProps<{ initial?: string | undefined; alert?: boolean }>();
</script>

<template>
  <button
    type="button"
    data-slot="avatar-button"
    class="relative hit-area inline-flex size-control-sm shrink-0 items-center justify-center rounded-full bg-hairline text-label text-foreground transition-colors hover:bg-accent"
  >
    <span v-if="props.initial" aria-hidden="true" data-test="account-initial">{{
      props.initial
    }}</span>
    <CircleUser v-else aria-hidden="true" class="size-4" />
    <span
      v-if="props.alert"
      aria-hidden="true"
      data-test="account-attention"
      class="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-signal"
    />
  </button>
</template>
