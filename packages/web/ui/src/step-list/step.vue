<script setup lang="ts">
import { Check } from "@lucide/vue";
import type { HTMLAttributes } from "vue";
import { cn } from "../cn";

const props = withDefaults(
  defineProps<{
    /** Its place in the list, shown in a sunken circle. */
    number: number;
    title: string;
    /** A finished step shows a check instead of its number. */
    done?: boolean;
    class?: HTMLAttributes["class"];
  }>(),
  { done: false },
);
</script>

<template>
  <li
    data-slot="step"
    :data-state="done ? 'done' : undefined"
    :class="cn('flex min-w-0 gap-3', props.class)"
  >
    <!-- The number sits in a 32px line, like the title beside it, so both centre on one row. -->
    <span aria-hidden="true" class="flex h-control-sm shrink-0 items-center">
      <span
        data-slot="step-number"
        class="flex size-6 items-center justify-center rounded-full text-meta text-muted-foreground tabular-nums tactile-sunken [&_svg]:size-3.5"
      >
        <Check v-if="done" />
        <template v-else>{{ number }}</template>
      </span>
    </span>
    <div class="flex min-w-0 flex-1 flex-col gap-2">
      <p
        data-slot="step-title"
        :class="
          cn('flex min-h-control-sm items-center text-label', done && 'text-muted-foreground')
        "
      >
        {{ title }}
      </p>
      <slot />
    </div>
  </li>
</template>
