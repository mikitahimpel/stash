<script setup lang="ts">
import { Search } from "@lucide/vue";
import type { HTMLAttributes } from "vue";
import { cn } from "../cn";
import { type ControlSize, controlSizes } from "../control/control-variants";
import { fieldInput, fieldWrapper } from "../control/field-classes";
import Kbd from "../kbd/kbd.vue";

// Attributes (placeholder, aria-label, name, autofocus, …) go to the input, not the wrapper.
defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    /** A shortcut shown as a keycap at the end, for example `⌘K` or `/`. */
    shortcut?: string;
    size?: ControlSize;
    class?: HTMLAttributes["class"];
  }>(),
  { size: "md" },
);
const model = defineModel<string>({ default: "" });
</script>

<template>
  <label data-slot="search-field" :class="cn(fieldWrapper, controlSizes[size], props.class)">
    <Search class="size-4 shrink-0" aria-hidden="true" />
    <input
      v-model="model"
      type="search"
      data-slot="search-field-input"
      v-bind="$attrs"
      :class="fieldInput"
    />
    <span v-if="shortcut" aria-hidden="true" class="flex"
      ><Kbd>{{ shortcut }}</Kbd></span
    >
  </label>
</template>
