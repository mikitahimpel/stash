<script setup lang="ts">
// A sample of one color token, for the `/_ui` gallery: a 24px square with its name.
const props = defineProps<{ token: string }>();
</script>

<template>
  <span data-slot="color-swatch" class="flex items-center gap-2 text-meta text-muted-foreground">
    <span
      aria-hidden="true"
      class="size-6 shrink-0 rounded-control border border-hairline"
      :style="{ background: `var(--${props.token})` }"
    />
    {{ props.token }}
  </span>
</template>
