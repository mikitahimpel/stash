<script setup lang="ts">
import AppBar from "@stash/web-ui/app-bar";
import AppFrame from "@stash/web-ui/app-frame";
import AppMain from "@stash/web-ui/app-main";
import AvatarButton from "@stash/web-ui/avatar-button";
import NavBar from "@stash/web-ui/nav-bar";
import NavShortcut from "@stash/web-ui/nav-shortcut";
import NavTab from "@stash/web-ui/nav-tab";
import Wordmark from "@stash/web-ui/wordmark";

// The app shell around a mockup: the real kit header with a static nav, so a mockup page needs no
// session and no api. Dev-only, like the pages that use it.
const props = defineProps<{ current: "Inbox" | "Search" }>();

const nav = ["Inbox", "Open now", "Search", "Connect", "Settings"] as const;
</script>

<template>
  <AppFrame>
    <AppBar>
      <Wordmark />
      <NavBar label="Main">
        <NavTab
          v-for="item in nav"
          :key="item"
          :active="item === props.current"
          v-bind="{ href: '#', 'aria-current': item === props.current ? 'page' : undefined }"
        >
          {{ item }}
          <NavShortcut v-if="item === 'Search'">⌘K</NavShortcut>
        </NavTab>
      </NavBar>
      <div class="ml-auto flex shrink-0 items-center">
        <AvatarButton initial="D" v-bind="{ 'aria-label': 'Account' }" />
      </div>
    </AppBar>
    <AppMain>
      <slot />
    </AppMain>
  </AppFrame>
</template>
