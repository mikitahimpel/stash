<script setup lang="ts">
import { X } from "@lucide/vue";
import {
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastRoot,
  ToastTitle,
  ToastViewport,
} from "reka-ui";
import type { HTMLAttributes } from "vue";
import { cn } from "../cn";
import type { ToastMessage } from "./toast-message";

const props = withDefaults(
  defineProps<{
    toasts: ReadonlyArray<ToastMessage>;
    duration?: number;
    closeLabel?: string;
    class?: HTMLAttributes["class"];
  }>(),
  { duration: 5000, closeLabel: "Close" },
);
const emit = defineEmits<{ dismiss: [id: string] }>();

const onOpenChange = (id: string, open: boolean) => {
  if (!open) emit("dismiss", id);
};
</script>

<template>
  <ToastProvider :duration="duration">
    <ToastRoot
      v-for="toast in toasts"
      :key="toast.id"
      data-slot="toast"
      :data-variant="toast.variant ?? 'default'"
      :open="true"
      :duration="toast.duration ?? duration"
      class="group pointer-events-auto relative flex w-full items-start gap-3 overflow-hidden rounded-md border bg-background p-4 pr-8 text-foreground shadow-lg data-[state=closed]:animate-out data-[state=closed]:fade-out-80 data-[state=open]:animate-in data-[state=open]:slide-in-from-top-full data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-(--reka-toast-swipe-end-x) data-[swipe=move]:translate-x-(--reka-toast-swipe-move-x) data-[swipe=move]:transition-none data-[variant=destructive]:border-destructive data-[variant=destructive]:bg-destructive data-[variant=destructive]:text-white sm:data-[state=open]:slide-in-from-bottom-full"
      @update:open="onOpenChange(toast.id, $event)"
    >
      <div class="grid gap-1">
        <ToastTitle data-slot="toast-title" class="text-sm font-semibold">{{
          toast.title
        }}</ToastTitle>
        <ToastDescription
          v-if="toast.description"
          data-slot="toast-description"
          class="text-sm opacity-90"
        >
          {{ toast.description }}
        </ToastDescription>
      </div>
      <ToastClose
        data-slot="toast-close"
        class="absolute top-2 right-2 rounded-md p-1 opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:outline-none [&_svg]:size-4"
      >
        <X />
        <span class="sr-only">{{ closeLabel }}</span>
      </ToastClose>
    </ToastRoot>
    <ToastViewport
      :class="
        cn(
          'fixed top-0 z-[100] flex max-h-screen w-full flex-col-reverse gap-2 p-4 sm:top-auto sm:right-0 sm:bottom-0 sm:flex-col md:max-w-[420px]',
          props.class,
        )
      "
    />
  </ToastProvider>
</template>
