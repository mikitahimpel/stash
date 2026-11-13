<script setup lang="ts">
import { TabsTrigger, type TabsTriggerProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { cn } from "../cn";
import { useForwardedProps } from "../forward-props";
import {
  segmentedControlItemVariants,
  segmentedControlThumb,
} from "../segmented-control/segmented-control-variants";

const props = defineProps<TabsTriggerProps & { class?: HTMLAttributes["class"] }>();
const delegated = useForwardedProps(props, ["class"]);
</script>

<template>
  <TabsTrigger
    data-slot="tabs-trigger"
    v-bind="delegated"
    :class="
      cn(
        segmentedControlItemVariants(),
        'group flex-1 gap-1.5 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-4',
        props.class,
      )
    "
  >
    <!-- The same raised thumb as the active segment of a SegmentedControl. -->
    <span
      aria-hidden="true"
      :class="[segmentedControlThumb, 'hidden group-data-[state=active]:block']"
    />
    <span class="relative inline-flex items-center gap-1.5"><slot /></span>
  </TabsTrigger>
</template>
