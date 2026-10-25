<script setup lang="ts">
import { TabsList, type TabsListProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { cn } from "../cn";
import { useForwardedProps } from "../forward-props";

const props = defineProps<TabsListProps & { class?: HTMLAttributes["class"] }>();
const delegated = useForwardedProps(props, ["class"]);
</script>

<template>
  <TabsList
    data-slot="tabs-list"
    v-bind="delegated"
    :class="
      cn(
        'inline-flex h-10 w-fit items-center justify-center rounded-lg bg-muted p-[3px] text-muted-foreground sm:h-9',
        props.class,
      )
    "
  >
    <slot />
  </TabsList>
</template>
