<script setup lang="ts">
import { type HTMLAttributes, ref } from "vue";
import { cn } from "../cn";
import { type ControlSize, controlSizes } from "../control/control-variants";
import { fieldInput, fieldWrapper } from "../control/field-classes";

// Attributes (type, placeholder, aria-label, name, readonly, …) go to the input, not the wrapper.
defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    size?: ControlSize;
    /** Mono text, for a code or token to copy. Nothing else is mono. */
    mono?: boolean;
    class?: HTMLAttributes["class"];
  }>(),
  { size: "md", mono: false },
);
const model = defineModel<string | number>();

const input = ref<HTMLInputElement>();
// The wrapper is the field's box and, on phones, its 44px hit area: a tap on it focuses the input.
const focus = (event: PointerEvent) => {
  if (event.target !== event.currentTarget) return;
  event.preventDefault();
  input.value?.focus();
};
</script>

<template>
  <div
    data-slot="input"
    :class="cn(fieldWrapper, controlSizes[size], props.class)"
    @pointerdown="focus"
  >
    <input
      ref="input"
      v-model="model"
      data-slot="input-control"
      v-bind="$attrs"
      :class="cn(fieldInput, mono && 'font-mono text-meta')"
    />
  </div>
</template>
