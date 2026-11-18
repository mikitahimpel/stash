<script setup lang="ts">
// One row of a <FieldPopup>: a button that picks the suggestion (an icon, the text, a muted note
// at the end) and, in `trailing`, a quiet action on it (a `ghost` `sm` button). The pick button
// is the row's own target (`data-row`), as a list row's title is.
defineProps<{
  /** The row the arrow keys are on. */
  active?: boolean;
}>();
const emit = defineEmits<{ pick: [] }>();

defineSlots<{
  default?: () => unknown;
  icon?: () => unknown;
  note?: () => unknown;
  trailing?: () => unknown;
}>();
</script>

<template>
  <li
    data-slot="field-popup-item"
    :data-active="active || undefined"
    class="flex items-center gap-1 rounded-control pr-1 hover:bg-accent data-[active]:bg-accent"
  >
    <button
      type="button"
      tabindex="-1"
      data-slot="field-popup-pick"
      data-row
      class="flex h-control-lg min-w-0 flex-1 cursor-default items-center gap-2 rounded-control px-2 text-left text-body text-foreground outline-hidden sm:h-control-md [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground"
      @click="emit('pick')"
    >
      <slot name="icon" />
      <span class="min-w-0 flex-1 truncate"><slot /></span>
      <span v-if="$slots.note" class="shrink-0 text-meta text-muted-foreground"
        ><slot name="note"
      /></span>
    </button>
    <slot name="trailing" />
  </li>
</template>
