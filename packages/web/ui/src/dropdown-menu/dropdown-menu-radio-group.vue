<script setup lang="ts">
import {
  DropdownMenuRadioGroup,
  type DropdownMenuRadioGroupEmits,
  type DropdownMenuRadioGroupProps,
  useEmitAsProps,
} from "reka-ui";
import { useForwardedProps } from "../forward-props";

const props = defineProps<DropdownMenuRadioGroupProps>();
const emits = defineEmits<DropdownMenuRadioGroupEmits>();
const forwarded = useForwardedProps(props);
const emitsAsProps = useEmitAsProps(emits);
</script>

<template>
  <DropdownMenuRadioGroup
    data-slot="dropdown-menu-radio-group"
    v-bind="{ ...forwarded, ...emitsAsProps }"
  >
    <slot />
  </DropdownMenuRadioGroup>
</template>
