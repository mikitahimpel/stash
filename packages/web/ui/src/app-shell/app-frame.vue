<script setup lang="ts">
// The whole screen behind the app: background, text color, full height, header over main.
</script>

<template>
  <div data-slot="app-frame" class="flex min-h-dvh flex-col bg-background text-foreground">
    <slot />
  </div>
</template>
