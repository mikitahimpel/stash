<script setup lang="ts">
// A full screen with one centred column, for pages outside the app frame (login).
</script>

<template>
  <main
    data-slot="centered-screen"
    class="flex min-h-dvh flex-col items-center justify-center gap-6 bg-background px-4 text-center text-foreground"
  >
    <slot />
  </main>
</template>
