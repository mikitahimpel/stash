<script setup lang="ts">
// The app header: one quiet row, 56px tall, sticky, hairline below. Its inner row has the same
// max width and side padding as <AppMain>, so the wordmark and the account button sit on the
// content edges.
</script>

<template>
  <header
    data-slot="app-bar"
    class="sticky top-0 z-10 border-b border-hairline bg-background pt-[env(safe-area-inset-top)]"
  >
    <div
      data-slot="app-bar-inner"
      class="mx-auto flex h-14 max-w-[960px] items-center gap-8 px-4 sm:px-6"
    >
      <slot />
    </div>
  </header>
</template>
