<script setup lang="ts">
// The place of the search field in <AppBar>. From `sm` up it is a compact field (300px) at the
// right end of the row, next to the account button. While it has the focus it is 480px (or what
// the row has left): it grows to the left, into the free space of its own place, so the nav and
// the account button stay where they are. On phones it is a full-width line under the row.
</script>

<template>
  <div
    data-slot="app-bar-search"
    class="col-span-2 row-start-2 w-full min-w-0 justify-self-stretch pb-3 sm:flex sm:flex-1 sm:justify-end sm:pb-0"
  >
    <div
      data-slot="app-bar-search-field"
      class="w-full min-w-0 sm:w-[300px] sm:max-w-full sm:transition-[width] sm:duration-150 sm:ease-out sm:focus-within:w-[480px] motion-reduce:transition-none"
    >
      <slot />
    </div>
  </div>
</template>
