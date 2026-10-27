<script setup lang="ts" generic="T extends string">
import { type ComponentPublicInstance, computed, type HTMLAttributes, ref } from "vue";
import { cn } from "../cn";
import type { SegmentedControlOption } from "./segmented-control-option";
import {
  segmentedControlItemVariants,
  segmentedControlVariants,
} from "./segmented-control-variants";

const props = defineProps<{
  options: ReadonlyArray<SegmentedControlOption<T>>;
  /** Names the group for screen readers. */
  label: string;
  class?: HTMLAttributes["class"];
}>();
const model = defineModel<T>({ required: true });

// The segment Tab lands on: the selected one, or the first when none is.
const tabStop = computed(() =>
  Math.max(
    0,
    props.options.findIndex((option) => option.value === model.value),
  ),
);

const segments = ref<Array<HTMLButtonElement>>([]);
const setSegment = (index: number) => (el: Element | ComponentPublicInstance | null) => {
  if (el instanceof HTMLButtonElement) segments.value[index] = el;
};

// A radio group: Tab enters on the selected segment, arrow keys (and Home / End) move the
// selection, wrapping around at the ends.
const select = (index: number) => {
  const count = props.options.length;
  const option = props.options[((index % count) + count) % count];
  if (option === undefined) return;
  model.value = option.value;
  segments.value[props.options.indexOf(option)]?.focus();
};

const onKeydown = (event: KeyboardEvent, index: number) => {
  const target = {
    ArrowRight: index + 1,
    ArrowDown: index + 1,
    ArrowLeft: index - 1,
    ArrowUp: index - 1,
    Home: 0,
    End: props.options.length - 1,
  }[event.key];
  if (target === undefined) return;
  event.preventDefault();
  select(target);
};
</script>

<template>
  <div
    role="radiogroup"
    data-slot="segmented-control"
    :aria-label="label"
    :class="cn(segmentedControlVariants(), props.class)"
  >
    <button
      v-for="(option, index) in options"
      :key="option.value"
      :ref="setSegment(index)"
      type="button"
      role="radio"
      data-slot="segmented-control-item"
      :data-state="option.value === model ? 'on' : 'off'"
      :aria-checked="option.value === model"
      :tabindex="index === tabStop ? 0 : -1"
      :class="segmentedControlItemVariants({ active: option.value === model })"
      @click="model = option.value"
      @keydown="onKeydown($event, index)"
    >
      {{ option.label }}
    </button>
  </div>
</template>
