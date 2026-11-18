<script setup lang="ts">
import { Primitive, type PrimitiveProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { cn } from "../cn";

interface Props extends PrimitiveProps {
  /** The row the keyboard is on. It lifts out of the list and shows its `actions`. */
  selected?: boolean;
  /** Not yet seen: an accent dot before the title. */
  unread?: boolean;
  /**
   * A row whose text is its content (a post): the meta line comes first, as the author's line,
   * and the title takes the two lines under it (a `<MediaRowTitle :lines="2">`). No summary line.
   * The row keeps the height of every other row.
   */
  metaFirst?: boolean;
  class?: HTMLAttributes["class"];
}

const props = withDefaults(defineProps<Props>(), {
  as: "div",
  selected: false,
  unread: false,
  metaFirst: false,
});

defineSlots<{
  /** The preview, a `<MediaThumb>`. */
  thumb?: () => unknown;
  /** The title, a `<MediaRowTitle>`: the row's target, it makes the whole row clickable. */
  title?: () => unknown;
  /** One line of metadata under the title; its items are separated by a middle dot. */
  meta?: () => unknown;
  /** One line of text under the meta: a summary. Cut with an ellipsis; not shown on phones. */
  summary?: () => unknown;
  /**
   * The tags, a `<TagLine>`. A list whose rows have tags passes the slot on every row, also when
   * the row has none: the line keeps its height. A list without tags (open tabs) leaves it out.
   */
  tags?: () => unknown;
  /** The row action bar, shown while the row is selected. */
  actions?: () => unknown;
}>();

// A list row with a preview, and one fixed height for every row of a list (#161): no row grows
// with its content.
//
// From `sm` up the 16:9 preview (160×90) sets the height and the text column fills it exactly:
// title (one line, 20) · meta (20) · summary (one line, 20) · tags (24), 2px apart. A line with
// nothing in it stays empty and keeps its place. A list without tags (open tabs) has three lines,
// and they sit in the middle of the same height: 13px above the title and under the summary, so
// the text never ends well above the preview's bottom (#164).
//
// On phones the preview is 110×62 beside the title (two lines at most) with the meta line right
// under it: the two share the preview's height, so a one-line title leaves the space below the
// meta. There is no summary, and the tags take one line under both, across the row.
//
// A `metaFirst` row (a post) has the same lines in another order: the meta line (who wrote it) on
// top, then the title over two lines, in the place of the meta and summary lines. On phones the
// meta line and the two lines of the title share the preview's height.
//
// Only the selected row is taller: it adds the action bar under its lines.
//
// From `sm` up the row's box sits exactly on the content edges and its content is inset by 12px,
// so the hover, focus and selected background never reaches past the page's edge. On phones there
// is no hover and the content uses the full width; a selected row's surface reaches 8px past the
// edges there. In the meta line only an item marked `data-shrink` (a channel, an author) gives
// way: its shrink factor is so large that the first item (the host) stays whole until there is
// nothing left of it, and only then truncates too.
</script>

<template>
  <Primitive
    data-slot="media-row"
    data-media-row=""
    :data-state="selected ? 'selected' : undefined"
    :data-meta-first="metaFirst ? '' : undefined"
    :as="as"
    :as-child="asChild"
    :class="
      cn(
        'relative grid grid-cols-[110px_minmax(0,1fr)] grid-rows-[auto_1fr] gap-x-3 gap-y-0.5 rounded-surface border border-transparent py-3 transition-colors has-[[data-slot=media-row-title]:focus-visible]:outline-2 has-[[data-slot=media-row-title]:focus-visible]:outline-offset-0 has-[[data-slot=media-row-title]:focus-visible]:outline-ring/40 sm:grid-cols-[160px_minmax(0,1fr)] sm:gap-x-4 sm:px-[11px] sm:py-[11px] sm:hover:bg-surface',
        // Without a tags line the three lines are centred: 13 + 20·3 + 13, with the gaps, is 90.
        $slots.tags ? 'sm:grid-rows-[20px_20px_20px_24px]' : 'sm:grid-rows-[33px_20px_20px_11px]',
        selected && 'tactile-row-selected max-sm:-mx-2 max-sm:px-[7px]',
        props.class,
      )
    "
  >
    <div
      data-slot="media-row-thumb"
      class="col-start-1 row-span-2 row-start-1 h-[62px] sm:row-span-4 sm:h-[90px]"
    >
      <slot name="thumb" />
    </div>
    <div
      data-slot="media-row-title-line"
      :class="
        cn(
          'col-start-2 flex min-w-0 items-start gap-2',
          metaFirst ? 'row-start-2 sm:row-span-2 sm:h-10' : 'row-start-1 sm:h-5',
          !$slots.tags && !metaFirst && 'sm:self-end',
        )
      "
    >
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
      data-slot="media-row-meta"
      :class="
        cn(
          'col-start-2 flex h-5 min-w-0 items-center overflow-hidden text-meta whitespace-nowrap text-muted-foreground [&>*]:shrink-0 [&>[data-shrink]]:min-w-0 [&>[data-shrink]]:shrink-[1000000] [&>[data-shrink]]:truncate [&>*+*]:before:mx-1.5 [&>*+*]:before:content-[\'·\'] [&>*:first-child]:min-w-0 [&>*:first-child]:shrink [&>*:first-child]:truncate',
          metaFirst ? 'row-start-1' : 'row-start-2 self-start',
        )
      "
    >
      <slot name="meta" />
    </div>
    <div
      v-if="!metaFirst"
      data-slot="media-row-summary"
      class="col-start-2 row-start-3 h-5 min-w-0 truncate text-body text-muted-foreground max-sm:hidden"
    >
      <slot name="summary" />
    </div>
    <div
      v-if="$slots.tags"
      data-slot="media-row-tags"
      class="col-span-2 col-start-1 row-start-3 mt-1.5 h-6 min-w-0 sm:col-span-1 sm:col-start-2 sm:row-start-4 sm:mt-0"
    >
      <slot name="tags" />
    </div>
    <div
      v-if="selected && $slots.actions"
      data-slot="media-row-actions"
      class="relative col-span-2 col-start-1 row-start-4 flex flex-wrap items-center gap-2 pt-1.5 sm:col-span-1 sm:col-start-2 sm:row-start-5"
    >
      <slot name="actions" />
    </div>
  </Primitive>
</template>
