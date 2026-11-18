<script setup lang="ts">
// The app header: one quiet row, 56px tall, sticky, hairline below. Its inner row has the same
// max width and side padding as <AppMain>, so the wordmark and the account button sit on the
// content edges. From `sm` up everything sits in that row. On phones the nav is a bottom bar, and
// <AppBarSearch> takes a second, full-width line under the row.
</script>

<template>
  <header
    data-slot="app-bar"
    class="sticky top-0 z-10 border-b border-hairline bg-background pt-[env(safe-area-inset-top)]"
  >
    <div
      data-slot="app-bar-inner"
      class="mx-auto grid max-w-[960px] grid-cols-[minmax(0,1fr)_auto] grid-rows-[3.5rem_auto] items-center justify-items-start px-4 sm:flex sm:h-14 sm:gap-8 sm:px-6"
    >
      <slot />
    </div>
  </header>
</template>
