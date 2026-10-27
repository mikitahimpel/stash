<script setup lang="ts">
import { TabsTrigger, type TabsTriggerProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { cn } from "../cn";
import { useForwardedProps } from "../forward-props";

const props = defineProps<TabsTriggerProps & { class?: HTMLAttributes["class"] }>();
const delegated = useForwardedProps(props, ["class"]);
</script>

<template>
  <TabsTrigger
    data-slot="tabs-trigger"
    v-bind="delegated"
    :class="
      cn(
        'inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-transparent px-3 text-[13px] font-medium text-muted-foreground transition-[background,box-shadow,color] hover:text-foreground disabled:pointer-events-none disabled:opacity-50 data-[state=active]:tactile-raised [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-4',
        props.class,
      )
    "
  >
    <slot />
  </TabsTrigger>
</template>
