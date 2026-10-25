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
        'inline-flex h-full flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-transparent px-3 py-1 text-sm font-medium text-foreground transition-[color,box-shadow] focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:shadow-sm dark:text-muted-foreground dark:data-[state=active]:border-input dark:data-[state=active]:bg-input/30 dark:data-[state=active]:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-4',
        props.class,
      )
    "
  >
    <slot />
  </TabsTrigger>
</template>
