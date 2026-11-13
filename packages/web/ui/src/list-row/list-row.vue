<script setup lang="ts">
import { Primitive, type PrimitiveProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { cn } from "../cn";

interface Props extends PrimitiveProps {
  /** The row the keyboard is on. It lifts out of the list and shows its `actions`. */
  selected?: boolean;
  class?: HTMLAttributes["class"];
}

const props = withDefaults(defineProps<Props>(), { as: "div", selected: false });

defineSlots<{
  /** Before the title, on the title line: a rank, an icon. */
  leading?: () => unknown;
  /** The title, usually a `<ListRowTitle>` (a link, or plain text). */
  title?: () => unknown;
  /** Metadata beside the title (under it on phones): 13px sans, muted. */
  meta?: () => unknown;
  /** One action at the end of the title line, such as a `ghost` `sm` button. */
  trailing?: () => unknown;
  /** Extra lines under the title line: a summary, tags. */
  default?: () => unknown;
  /** The row action bar, shown while the row is selected. */
  actions?: () => unknown;
}>();

// The 1px border (transparent until selected) plus 11px padding make the 12px inset.
// Every list uses this one layout: leading · title · meta · trailing on a 36px title line, then
// extra lines. The row's box reaches 12px past the content edge on both sides, so its text starts
// on the content edge and its hover, focus and selected background has room around it. The divider
// (::before) stays within the content edges.
</script>

<template>
  <Primitive
    data-slot="list-row"
    data-list-row=""
    :data-state="selected ? 'selected' : undefined"
    :as="as"
    :as-child="asChild"
    :class="
      cn(
        'relative -mx-3 flex items-start gap-3 rounded-control border border-transparent px-[11px] py-2 transition-colors before:absolute before:inset-x-3 before:-bottom-px before:h-px before:bg-hairline-row last:before:hidden hover:bg-surface has-[[data-row]:focus-visible]:outline-2 has-[[data-row]:focus-visible]:outline-offset-0 has-[[data-row]:focus-visible]:outline-ring/40',
        selected && 'tactile-row-selected before:hidden',
        props.class,
      )
    "
  >
    <div
      v-if="$slots.leading"
      data-slot="list-row-leading"
      class="flex h-control-md shrink-0 items-center text-meta text-muted-foreground tabular-nums"
    >
      <slot name="leading" />
    </div>
    <div class="flex min-w-0 flex-1 flex-col gap-1">
      <div
        v-if="$slots.title || $slots.meta"
        data-slot="list-row-title-line"
        class="flex min-w-0 flex-col sm:min-h-control-md sm:flex-row sm:items-center sm:gap-4"
      >
        <slot name="title" />
        <div
          v-if="$slots.meta"
          data-slot="list-row-meta"
          class="flex min-w-0 shrink-0 flex-wrap items-center gap-x-3 text-meta text-muted-foreground"
        >
          <slot name="meta" />
        </div>
      </div>
      <slot />
      <div
        v-if="selected && $slots.actions"
        data-slot="list-row-actions"
        class="flex flex-wrap items-center gap-2 pt-1"
      >
        <slot name="actions" />
      </div>
    </div>
    <div
      v-if="$slots.trailing"
      data-slot="list-row-trailing"
      class="flex h-control-md shrink-0 items-center gap-2"
    >
      <slot name="trailing" />
    </div>
  </Primitive>
</template>
