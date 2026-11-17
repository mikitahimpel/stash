<script setup lang="ts">
// A matched term. `surface` (the default) is for muted text: full contrast on a faint surface.
// `signal` tints it with the accent, for text that is already at full contrast (a row title) and
// for rows whose hover background is the surface.
const props = withDefaults(defineProps<{ tone?: "surface" | "signal" }>(), { tone: "surface" });
</script>

<template>
  <mark
    data-slot="match-mark"
    :class="[
      'rounded-sm px-0.5 text-foreground',
      props.tone === 'signal' ? 'bg-signal/25' : 'bg-surface',
    ]"
    ><slot
  /></mark>
</template>
