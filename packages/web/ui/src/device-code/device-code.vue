<script setup lang="ts">
const props = defineProps<{ label: string }>();
</script>

<template>
  <output
    data-slot="device-code"
    :aria-label="props.label"
    class="flex h-control-lg min-w-0 flex-1 items-center justify-center rounded-control font-mono text-xl font-medium tracking-[0.2em] select-all tactile-sunken"
  >
    <!-- A code to type elsewhere (the GitHub device code): a sunken 44px box in large mono, the
         one place besides keys and chart axes where mono is used. --><slot
  /></output>
</template>
