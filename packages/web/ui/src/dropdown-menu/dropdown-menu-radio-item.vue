<script setup lang="ts">
import { Check } from "@lucide/vue";
import {
  DropdownMenuItemIndicator,
  DropdownMenuRadioItem,
  type DropdownMenuRadioItemEmits,
  type DropdownMenuRadioItemProps,
  useEmitAsProps,
} from "reka-ui";
import type { HTMLAttributes } from "vue";
import { cn } from "../cn";
import { useForwardedProps } from "../forward-props";

const props = defineProps<DropdownMenuRadioItemProps & { class?: HTMLAttributes["class"] }>();
const emits = defineEmits<DropdownMenuRadioItemEmits>();
const delegated = useForwardedProps(props, ["class"]);
const emitsAsProps = useEmitAsProps(emits);
</script>

<template>
  <!-- One choice of a `menuitemradio` group: the checked one carries a check mark on the right. -->
  <DropdownMenuRadioItem
    data-slot="dropdown-menu-radio-item"
    v-bind="{ ...delegated, ...emitsAsProps }"
    :class="
      cn(
        'relative flex cursor-default items-center gap-2 rounded-md py-2 pr-8 pl-2 text-[13px] outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 sm:py-1.5 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-4 [&_svg:not([class*=text-])]:text-muted-foreground',
        props.class,
      )
    "
  >
    <slot />
    <DropdownMenuItemIndicator class="absolute right-2 flex items-center">
      <Check class="text-foreground" aria-hidden="true" />
    </DropdownMenuItemIndicator>
  </DropdownMenuRadioItem>
</template>
