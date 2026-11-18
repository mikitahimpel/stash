<script setup lang="ts">
// The place of the search field in <AppBar>: from `sm` up it fills the row between the nav and the
// account button; on phones it is a full-width line under the row.
</script>

<template>
  <div
    data-slot="app-bar-search"
    class="col-span-2 row-start-2 w-full min-w-0 justify-self-stretch pb-3 sm:flex-1 sm:pb-0"
  >
    <slot />
  </div>
</template>
