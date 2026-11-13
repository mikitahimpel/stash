<script setup lang="ts">
const props = defineProps<{ label: string }>();
</script>

<template>
  <nav
    data-slot="nav-bar"
    :aria-label="props.label"
    class="fixed inset-x-0 bottom-0 z-10 flex border-t border-hairline bg-background px-4 pb-[env(safe-area-inset-bottom)] sm:static sm:z-auto sm:h-14 sm:gap-6 sm:border-0 sm:bg-transparent sm:p-0"
  >
    <!-- Plain text tabs. On phones a bottom bar (fixed, above the home indicator); from `sm` up they
         sit in the app bar, with the indicator on its bottom edge. -->
    <slot />
  </nav>
</template>
