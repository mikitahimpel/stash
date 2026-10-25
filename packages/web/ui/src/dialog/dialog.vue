<script setup lang="ts">
import { DialogRoot, type DialogRootProps, type DialogRootEmits, useEmitAsProps } from "reka-ui";
import { useForwardedProps } from "../forward-props";

const props = defineProps<DialogRootProps>();
const emits = defineEmits<DialogRootEmits>();
const forwarded = useForwardedProps(props);
const emitsAsProps = useEmitAsProps(emits);
</script>

<template>
  <DialogRoot v-slot="slotProps" v-bind="{ ...forwarded, ...emitsAsProps }">
    <slot v-bind="slotProps" />
  </DialogRoot>
</template>
