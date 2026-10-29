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
    <!-- On phones the bottom padding clears the nav bar fixed at the bottom of the screen. -->
    <main
      class="mx-auto w-full max-w-[1040px] flex-1 px-4 pt-6 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:px-6 sm:pt-8 sm:pb-12"
    >
      <RouterView />
    </main>
  </div>
</template>
