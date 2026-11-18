<script setup lang="ts">
import { Primitive, type PrimitiveProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { cn } from "../cn";

interface Props extends PrimitiveProps {
  /** The row the keyboard is on. It lifts out of the list and shows its `actions`. */
  selected?: boolean;
  /** Not yet seen: an accent dot before the title. */
  unread?: boolean;
  class?: HTMLAttributes["class"];
}

const props = withDefaults(defineProps<Props>(), { as: "div", selected: false, unread: false });

defineSlots<{
  /** The preview, a `<MediaThumb>`. */
  thumb?: () => unknown;
  /** The title, a `<MediaRowTitle>`: the row's target, it makes the whole row clickable. */
  title?: () => unknown;
  /** One line of metadata under the title; its items are separated by a middle dot. */
  meta?: () => unknown;
  /** Extra lines: a summary, tags. */
  default?: () => unknown;
  /** The row action bar, shown while the row is selected. */
  actions?: () => unknown;
}>();

// A list row with a preview: thumb · title (2 lines) · one meta line · extra lines. From `sm` up
// the row's box sits exactly on the content edges and its content is inset by 12px, so the hover,
// focus and selected background never reaches past the page's edge. On phones there is no hover and
// the content uses the full width; a selected row's surface reaches 8px past the edges there.
// In the meta line an item marked `data-shrink` (a channel, an author) gives way first; the first
// item (the host) truncates too.
</script>

<template>
  <Primitive
    data-slot="media-row"
    data-media-row=""
    :data-state="selected ? 'selected' : undefined"
    :as="as"
    :as-child="asChild"
    :class="
      cn(
        'relative flex items-start gap-3 rounded-surface border border-transparent py-3 transition-colors has-[[data-slot=media-row-title]:focus-visible]:outline-2 has-[[data-slot=media-row-title]:focus-visible]:outline-offset-0 has-[[data-slot=media-row-title]:focus-visible]:outline-ring/40 sm:gap-4 sm:px-[11px] sm:py-[11px] sm:hover:bg-surface',
        selected && 'tactile-row-selected max-sm:-mx-2 max-sm:px-[7px]',
        props.class,
      )
    "
  >
    <div v-if="$slots.thumb" data-slot="media-row-thumb" class="shrink-0">
      <slot name="thumb" />
    </div>
    <div data-slot="media-row-body" class="flex min-w-0 flex-1 flex-col gap-1">
      <div v-if="$slots.title" class="flex min-w-0 items-start gap-2">
        <span
          v-if="unread"
          data-slot="media-row-unread"
          role="img"
          aria-label="Not yet seen"
          class="mt-[7px] size-1.5 shrink-0 rounded-full bg-signal"
        />
        <slot name="title" />
      </div>
      <div
        v-if="$slots.meta"
        data-slot="media-row-meta"
        class="flex min-w-0 items-center overflow-hidden text-meta whitespace-nowrap text-muted-foreground [&>*]:shrink-0 [&>[data-shrink]]:min-w-0 [&>[data-shrink]]:shrink [&>[data-shrink]]:truncate [&>*+*]:before:mx-1.5 [&>*+*]:before:content-['·'] [&>*:first-child]:min-w-0 [&>*:first-child]:shrink [&>*:first-child]:truncate"
      >
        <slot name="meta" />
      </div>
      <slot />
      <div
        v-if="selected && $slots.actions"
        data-slot="media-row-actions"
        class="relative flex flex-wrap items-center gap-2 pt-2"
      >
        <slot name="actions" />
      </div>
    </div>
  </Primitive>
</template>
