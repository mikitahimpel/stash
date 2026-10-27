<script setup lang="ts">
import { Search } from "@lucide/vue";
import type { HTMLAttributes } from "vue";
import { cn } from "../cn";
import Kbd from "../kbd/kbd.vue";

// Attributes (placeholder, aria-label, name, autofocus, …) go to the input, not the wrapper.
defineOptions({ inheritAttrs: false });

const props = defineProps<{
  /** A shortcut shown as a keycap at the end, for example `⌘K` or `/`. */
  shortcut?: string;
  class?: HTMLAttributes["class"];
}>();
const model = defineModel<string>({ default: "" });
</script>

<template>
  <label
    data-slot="search-field"
    :class="
      cn(
        'flex h-10 w-full min-w-0 items-center gap-2 rounded-lg px-3 text-muted-foreground tactile-sunken focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring/40 sm:h-9',
        props.class,
      )
    "
  >
    <Search class="size-4 shrink-0" aria-hidden="true" />
    <input
      v-model="model"
      type="search"
      data-slot="search-field-input"
      v-bind="$attrs"
      class="h-full min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
    />
    <span v-if="shortcut" aria-hidden="true" class="flex"
      ><Kbd class="text-muted-foreground">{{ shortcut }}</Kbd></span
    >
  </label>
</template>
