<script setup lang="ts">
import * as Auth from "@stash/web-auth/routes";
import { RouterView, useRoute } from "vue-router";
import AppHeader from "./app-header.vue";

const route = useRoute();
</script>

<template>
  <!-- The login page brings its own full-screen layout, without the nav. -->
  <RouterView v-if="Auth.isPublic(route)" />
  <div v-else class="flex min-h-dvh flex-col bg-background text-foreground">
    <AppHeader />
    <main
      class="mx-auto w-full max-w-[1040px] flex-1 px-4 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6"
    >
      <RouterView />
    </main>
  </div>
</template>
