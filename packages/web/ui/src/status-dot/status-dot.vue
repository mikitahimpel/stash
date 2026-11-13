<script setup lang="ts">
// An 8px dot in front of a status: `signal` when it needs attention, `muted` otherwise.
const props = withDefaults(defineProps<{ tone?: "signal" | "muted" }>(), { tone: "muted" });
</script>

<template>
  <span
    data-slot="status-dot"
    aria-hidden="true"
    :class="[
      'size-2 shrink-0 rounded-full',
      props.tone === 'signal' ? 'bg-signal' : 'bg-muted-foreground',
    ]"
  />
</template>
