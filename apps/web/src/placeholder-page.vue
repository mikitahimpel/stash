<script setup lang="ts">
import EmptyState from "@stash/web-ui/empty-state";

defineProps<{ title: string }>();
</script>

<template>
  <section class="flex flex-col gap-4">
    <h1 class="text-xl font-semibold">{{ title }}</h1>
    <EmptyState :title="`${title} is coming soon`" description="This page is not built yet." />
  </section>
</template>
