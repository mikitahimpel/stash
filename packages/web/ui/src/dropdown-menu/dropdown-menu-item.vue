<script setup lang="ts">
import {
  DropdownMenuItem,
  type DropdownMenuItemEmits,
  type DropdownMenuItemProps,
  useEmitAsProps,
} from "reka-ui";
import type { HTMLAttributes } from "vue";
import { cn } from "../cn";
import { useForwardedProps } from "../forward-props";

const props = withDefaults(
  defineProps<
    DropdownMenuItemProps & {
      class?: HTMLAttributes["class"];
      variant?: "default" | "destructive";
    }
  >(),
  { variant: "default" },
);
const emits = defineEmits<DropdownMenuItemEmits>();
const delegated = useForwardedProps(props, ["class", "variant"]);
const emitsAsProps = useEmitAsProps(emits);
</script>

<template>
  <DropdownMenuItem
    data-slot="dropdown-menu-item"
    :data-variant="variant"
    v-bind="{ ...delegated, ...emitsAsProps }"
    :class="
      cn(
        'relative flex cursor-default items-center gap-2 h-control-lg rounded-control px-2 text-body sm:h-control-md outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:text-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-4 [&_svg:not([class*=text-])]:text-muted-foreground',
        props.class,
      )
    "
  >
    <slot />
  </DropdownMenuItem>
</template>
