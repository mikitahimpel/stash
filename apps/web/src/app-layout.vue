<script setup lang="ts">
import * as Auth from "@stash/web-auth/routes";
import AppFrame from "@stash/web-ui/app-frame";
import AppMain from "@stash/web-ui/app-main";
import { RouterView, useRoute } from "vue-router";
import AppHeader from "./app-header.vue";

const route = useRoute();

// The login page brings its own full-screen layout, without the nav.
</script>

<template>
  <RouterView v-if="Auth.isPublic(route)" />
  <AppFrame v-else>
    <AppHeader />
    <AppMain>
      <RouterView />
    </AppMain>
  </AppFrame>
</template>
