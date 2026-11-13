<script setup lang="ts">
// The page area: 960px wide, centred, 16px side padding on phones and 24px from `sm` up. On phones
// the bottom padding clears the nav bar fixed at the bottom of the screen.
</script>

<template>
  <main
    data-slot="app-main"
    class="mx-auto w-full max-w-[960px] flex-1 px-4 pt-6 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:px-6 sm:pt-8 sm:pb-12"
  >
    <slot />
  </main>
</template>
