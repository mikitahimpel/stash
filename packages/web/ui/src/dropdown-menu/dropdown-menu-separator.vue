<script setup lang="ts">
import { DropdownMenuSeparator, type DropdownMenuSeparatorProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { cn } from "../cn";
import { useForwardedProps } from "../forward-props";

const props = defineProps<DropdownMenuSeparatorProps & { class?: HTMLAttributes["class"] }>();
const delegated = useForwardedProps(props, ["class"]);
</script>

<template>
  <DropdownMenuSeparator
    data-slot="dropdown-menu-separator"
    v-bind="delegated"
    :class="cn('-mx-1 my-1 h-px bg-border', props.class)"
  />
</template>
