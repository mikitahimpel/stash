<script setup lang="ts">
import { X } from "@lucide/vue";
import {
  DialogClose,
  DialogContent,
  type DialogContentEmits,
  type DialogContentProps,
  DialogOverlay,
  DialogPortal,
  useEmitAsProps,
} from "reka-ui";
import type { HTMLAttributes } from "vue";
import { cn } from "../cn";
import { useForwardedProps } from "../forward-props";

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<
    DialogContentProps & {
      class?: HTMLAttributes["class"];
      showCloseButton?: boolean;
      closeLabel?: string;
    }
  >(),
  { showCloseButton: true, closeLabel: "Close" },
);
const emits = defineEmits<DialogContentEmits>();
const delegated = useForwardedProps(props, ["class", "showCloseButton", "closeLabel"]);
const emitsAsProps = useEmitAsProps(emits);
</script>

<template>
  <DialogPortal>
    <DialogOverlay
      data-slot="dialog-overlay"
      class="fixed inset-0 z-50 bg-black/50 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0"
    />
    <DialogContent
      data-slot="dialog-content"
      v-bind="{ ...$attrs, ...delegated, ...emitsAsProps }"
      :class="
        cn(
          'fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border bg-background p-6 shadow-lg duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 sm:max-w-lg',
          props.class,
        )
      "
    >
      <slot />
      <DialogClose
        v-if="showCloseButton"
        data-slot="dialog-close"
        class="absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-4"
      >
        <X />
        <span class="sr-only">{{ closeLabel }}</span>
      </DialogClose>
    </DialogContent>
  </DialogPortal>
</template>
