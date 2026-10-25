<script setup lang="ts">
import { DropdownMenuTrigger, type DropdownMenuTriggerProps } from "reka-ui";
import { useForwardedProps } from "../forward-props";

const props = defineProps<DropdownMenuTriggerProps>();
const forwarded = useForwardedProps(props);
</script>

<template>
  <DropdownMenuTrigger data-slot="dropdown-menu-trigger" v-bind="forwarded">
    <slot />
  </DropdownMenuTrigger>
</template>
