<script setup lang="ts">
import { DialogTrigger, type DialogTriggerProps } from "reka-ui";
import { useForwardedProps } from "../forward-props";

const props = defineProps<DialogTriggerProps>();
const forwarded = useForwardedProps(props);
</script>

<template>
  <DialogTrigger data-slot="dialog-trigger" v-bind="forwarded">
    <slot />
  </DialogTrigger>
</template>
