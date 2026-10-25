<script setup lang="ts">
import {
  DropdownMenuRoot,
  type DropdownMenuRootProps,
  type DropdownMenuRootEmits,
  useEmitAsProps,
} from "reka-ui";
import { useForwardedProps } from "../forward-props";

const props = defineProps<DropdownMenuRootProps>();
const emits = defineEmits<DropdownMenuRootEmits>();
const forwarded = useForwardedProps(props);
const emitsAsProps = useEmitAsProps(emits);
</script>

<template>
  <DropdownMenuRoot v-slot="slotProps" v-bind="{ ...forwarded, ...emitsAsProps }">
    <slot v-bind="slotProps" />
  </DropdownMenuRoot>
</template>
