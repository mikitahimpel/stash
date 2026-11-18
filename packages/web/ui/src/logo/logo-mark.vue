<script setup lang="ts">
import markUrl from "./stash-mark.svg";
import smallMarkUrl from "./stash-mark-sm.svg";

// The Well mark: a dark tactile squircle with a glowing orange core. `sm` (28px) and `md` (44px)
// draw the small version, made to read from 16px up; `lg` (96px) draws the full one with its three
// steps. It is an <img>, so the gradient and filter ids of the SVG never meet the page's own.
// Next to the wordmark it is decoration; alone, give it a `label`.
const props = withDefaults(defineProps<{ size?: "sm" | "md" | "lg"; label?: string }>(), {
  size: "sm",
  label: "",
});

const sizes = { sm: 28, md: 44, lg: 96 } as const;
</script>

<template>
  <img
    data-slot="logo-mark"
    :data-size="props.size"
    :src="props.size === 'lg' ? markUrl : smallMarkUrl"
    :alt="props.label"
    :width="sizes[props.size]"
    :height="sizes[props.size]"
    class="block shrink-0 data-[size=lg]:size-24 data-[size=md]:size-11 data-[size=sm]:size-7"
    draggable="false"
  />
</template>
