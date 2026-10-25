<script setup lang="ts">
import { TabsRoot, type TabsRootEmits, type TabsRootProps, useEmitAsProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { cn } from "../cn";
import { useForwardedProps } from "../forward-props";

const props = defineProps<TabsRootProps & { class?: HTMLAttributes["class"] }>();
const emits = defineEmits<TabsRootEmits>();
const delegated = useForwardedProps(props, ["class"]);
const emitsAsProps = useEmitAsProps(emits);
</script>

<template>
  <TabsRoot
    v-slot="slotProps"
    data-slot="tabs"
    v-bind="{ ...delegated, ...emitsAsProps }"
    :class="cn('flex flex-col gap-2', props.class)"
  >
    <slot v-bind="slotProps" />
  </TabsRoot>
</template>
