<script setup lang="ts">
import { TabsContent, type TabsContentProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { cn } from "../cn";
import { useForwardedProps } from "../forward-props";

const props = defineProps<TabsContentProps & { class?: HTMLAttributes["class"] }>();
const delegated = useForwardedProps(props, ["class"]);
</script>

<template>
  <TabsContent
    data-slot="tabs-content"
    v-bind="delegated"
    :class="cn('flex-1 outline-none', props.class)"
  >
    <slot />
  </TabsContent>
</template>
