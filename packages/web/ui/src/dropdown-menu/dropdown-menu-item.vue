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
        'relative flex cursor-default items-center gap-2 rounded-sm px-2 py-2 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:focus:text-destructive sm:py-1.5 dark:data-[variant=destructive]:focus:bg-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-4 [&_svg:not([class*=text-])]:text-muted-foreground',
        props.class,
      )
    "
  >
    <slot />
  </DropdownMenuItem>
</template>
