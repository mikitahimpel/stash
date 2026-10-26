<script setup lang="ts">
import { AppWindow, Link, Search, Settings } from "@lucide/vue";
import LogoutButton from "@stash/web-auth/logout-button";
import * as Auth from "@stash/web-auth/routes";
import { RouterLink, RouterView, useRoute } from "vue-router";

const route = useRoute();

const nav = [
  { name: "links", label: "Links", icon: Link },
  { name: "search", label: "Search", icon: Search },
  { name: "open-tabs", label: "Open now", icon: AppWindow },
  { name: "settings", label: "Settings", icon: Settings },
] as const;
</script>

<template>
  <!-- The login page brings its own full-screen layout, without the nav. -->
  <RouterView v-if="Auth.isPublic(route)" />
  <div v-else class="flex min-h-dvh flex-col bg-background text-foreground">
    <header
      class="sticky top-0 z-10 border-b bg-background/95 pt-[env(safe-area-inset-top)] backdrop-blur"
    >
      <div class="mx-auto flex h-14 max-w-4xl items-center gap-6 px-4">
        <RouterLink :to="{ name: 'links' }" class="text-lg font-semibold">Stash</RouterLink>
        <nav aria-label="Main" class="hidden gap-1 sm:flex">
          <RouterLink
            v-for="item in nav"
            :key="item.name"
            :to="{ name: item.name }"
            class="rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            active-class="bg-accent text-accent-foreground"
          >
            {{ item.label }}
          </RouterLink>
        </nav>
        <LogoutButton class="ml-auto" />
      </div>
    </header>

    <main class="mx-auto w-full max-w-4xl flex-1 px-4 py-6 pb-24 sm:pb-6">
      <RouterView />
    </main>

    <!-- Phones get a bottom tab bar instead of the header links. -->
    <nav
      aria-label="Main"
      class="fixed inset-x-0 bottom-0 z-10 grid grid-cols-4 border-t bg-background pb-[env(safe-area-inset-bottom)] sm:hidden"
    >
      <RouterLink
        v-for="item in nav"
        :key="item.name"
        :to="{ name: item.name }"
        class="flex flex-col items-center gap-1 py-2 text-xs text-muted-foreground"
        active-class="text-foreground"
      >
        <component :is="item.icon" class="size-5" aria-hidden="true" />
        {{ item.label }}
      </RouterLink>
    </nav>
  </div>
</template>
