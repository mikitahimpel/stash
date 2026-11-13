<script setup lang="ts">
import { TabsList, type TabsListProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { cn } from "../cn";
import { segmentedControlVariants } from "../segmented-control/segmented-control-variants";
import { useForwardedProps } from "../forward-props";

const props = defineProps<TabsListProps & { class?: HTMLAttributes["class"] }>();
const delegated = useForwardedProps(props, ["class"]);
</script>

<template>
  <TabsList
    data-slot="tabs-list"
    v-bind="delegated"
    :class="
      cn(segmentedControlVariants({ size: 'md' }), 'w-fit text-muted-foreground', props.class)
    "
  >
    <slot />
  </TabsList>
</template>
