<script setup lang="ts">
// A panel that hangs under a field, as wide as the field: suggestions for what to type (recent
// searches). The field goes in the default slot and the rows (<FieldPopupItem>) in `panel`. The
// panel never takes the focus: a press on it leaves the field focused, so the field's own
// `focus` / `blur` can open and close it.
defineProps<{
  open: boolean;
  /** The accessible name of the list in the panel. */
  label: string;
}>();

defineSlots<{ default?: () => unknown; panel?: () => unknown }>();
</script>

<template>
  <div data-slot="field-popup" class="relative">
    <slot />
    <ul
      v-if="open"
      data-slot="field-popup-panel"
      :aria-label="label"
      class="absolute inset-x-0 top-full z-50 mt-1 flex flex-col rounded-surface border border-hairline bg-popover p-1 text-popover-foreground shadow-(--popover-shadow)"
      @mousedown.prevent
    >
      <slot name="panel" />
    </ul>
  </div>
</template>
