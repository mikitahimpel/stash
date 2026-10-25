<script setup lang="ts">
import { DialogClose, type DialogCloseProps } from "reka-ui";
import { useForwardedProps } from "../forward-props";

const props = defineProps<DialogCloseProps>();
const forwarded = useForwardedProps(props);
</script>

<template>
  <DialogClose data-slot="dialog-close" v-bind="forwarded">
    <slot />
  </DialogClose>
</template>
