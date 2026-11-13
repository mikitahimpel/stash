<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { cn } from "../cn";

const props = defineProps<{ class?: HTMLAttributes["class"] }>();
</script>

<template>
  <div
    data-slot="card"
    :class="
      cn(
        'flex flex-col rounded-surface border border-hairline bg-card px-4 py-2 text-card-foreground',
        props.class,
      )
    "
  >
    <!-- A surface: radius 12, hairline border, 16px content edge. Rows inside start on that edge
         too (ListRow reaches 12px past it for its background). -->
    <slot />
  </div>
</template>
