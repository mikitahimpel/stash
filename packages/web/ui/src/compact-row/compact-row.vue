<script setup lang="ts">
import { Primitive, type PrimitiveProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { cn } from "../cn";

interface Props extends PrimitiveProps {
  /** The row the keyboard is on. It lifts out of the list and shows its `actions`. */
  selected?: boolean;
  /** Its `actions` are out: a finger swiped the row to the left (`v-model:revealed`). */
  revealed?: boolean;
  /**
   * The row is going away by itself (a tab closed on its device): it fades out in its place and
   * takes no input. The list removes it once `leaveMillis` have passed.
   */
  leaving?: boolean;
  class?: HTMLAttributes["class"];
}

const props = withDefaults(defineProps<Props>(), {
  as: "div",
  selected: false,
  revealed: false,
  leaving: false,
});

const emit = defineEmits<{
  /** A swipe to the left (`true`) or back to the right (`false`), by a finger or a pen. */
  "update:revealed": [revealed: boolean];
  /** A finger held on the row for half a second: the page's cue to start selecting rows. */
  hold: [];
}>();

defineSlots<{
  /** A 20px mark before the text: a `<SiteIcon>`, or a `<CheckToggle>` while rows are picked. */
  leading?: () => unknown;
  /** The title, a `<CompactRowTitle>`. */
  title?: () => unknown;
  /** One muted line under the title; its items are separated by a middle dot. */
  meta?: () => unknown;
  /** At the end of the row, always there: a `<CompactRowThumb>`, a `<Badge>`. */
  trailing?: () => unknown;
  /**
   * The row's actions, `ghost` `sm` buttons at its end. They show under the pointer, with the
   * keyboard's focus, while the row is `selected` and, on a touch screen, after a swipe to the left.
   */
  actions?: () => unknown;
}>();

// A dense row for a list that is scanned, not read (open tabs, #181): 48px at every width, a 20px
// mark, the title on one line and one muted line under it. Every row of a list is this height,
// whatever it holds; a row with more to show (a saved tab's preview) puts it in `trailing`, inside
// the same height. Nothing in it wraps or grows.
//
// The actions take their place at the end of the row when they show, and the text gives way to
// them (it is cut shorter), so the row never changes height and nothing below it moves. On a
// phone they take the place of `trailing`.
//
// As with a `<MediaRow>`, from `sm` up the row's box sits exactly on the content edges and its
// content is inset by 12px; on phones the content uses the full width.

const swipeDistance = 40;
const holdMillis = 500;
const slop = 10;

let start: { readonly x: number; readonly y: number } | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
// The click that ends a hold or a swipe is not a click on the row.
let swallow = false;

const stop = () => {
  start = undefined;
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
};

const onPointerDown = (event: PointerEvent) => {
  stop();
  swallow = false;
  if (event.pointerType === "mouse") return;
  start = { x: event.clientX, y: event.clientY };
  timer = setTimeout(() => {
    stop();
    swallow = true;
    emit("hold");
  }, holdMillis);
};

const onPointerMove = (event: PointerEvent) => {
  if (start === undefined) return;
  const dx = event.clientX - start.x;
  const dy = event.clientY - start.y;
  if (Math.abs(dx) > slop || Math.abs(dy) > slop) {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  }
  if (Math.abs(dx) >= swipeDistance && Math.abs(dx) > 2 * Math.abs(dy)) {
    stop();
    swallow = true;
    emit("update:revealed", dx < 0);
  }
};

const onClickCapture = (event: MouseEvent) => {
  if (!swallow) return;
  swallow = false;
  event.preventDefault();
  event.stopPropagation();
};

// A held finger also opens the browser's own menu for a link; the hold is taken here instead.
const onContextMenu = (event: MouseEvent) => {
  if (swallow) event.preventDefault();
};

// As an object: `<Primitive>` declares no events of its own.
const listeners = {
  onPointerdown: onPointerDown,
  onPointermove: onPointerMove,
  onPointerup: stop,
  onPointercancel: stop,
  onClickCapture,
  onContextmenu: onContextMenu,
};

const metaLine =
  "flex h-5 min-w-0 items-center overflow-hidden text-meta whitespace-nowrap text-muted-foreground [&>*]:shrink-0 [&>[data-shrink]]:min-w-0 [&>[data-shrink]]:shrink-[1000000] [&>[data-shrink]]:truncate [&>*+*]:before:mx-1.5 [&>*+*]:before:content-['·'] [&>*:first-child]:min-w-0 [&>*:first-child]:shrink [&>*:first-child]:truncate";
</script>

<template>
  <Primitive
    data-slot="compact-row"
    data-compact-row=""
    :data-state="selected ? 'selected' : undefined"
    :data-revealed="revealed ? '' : undefined"
    :data-leaving="leaving ? '' : undefined"
    :as="as"
    :as-child="asChild"
    :class="
      cn(
        'group/row relative flex h-12 touch-pan-y items-center gap-3 rounded-control border border-transparent transition-colors [-webkit-touch-callout:none] before:absolute before:inset-x-0 before:-bottom-px before:h-px before:bg-hairline-row last:before:hidden has-[[data-slot=compact-row-title]:focus-visible]:outline-2 has-[[data-slot=compact-row-title]:focus-visible]:outline-offset-0 has-[[data-slot=compact-row-title]:focus-visible]:outline-ring/40 sm:px-[11px] sm:before:inset-x-3 sm:hover:bg-surface',
        selected && 'tactile-row-selected before:hidden max-sm:-mx-2 max-sm:px-[7px]',
        leaving && 'pointer-events-none opacity-0 transition-opacity duration-300 ease-out',
        props.class,
      )
    "
    v-bind="listeners"
  >
    <div
      v-if="$slots.leading"
      data-slot="compact-row-leading"
      class="flex size-5 shrink-0 items-center justify-center"
    >
      <slot name="leading" />
    </div>
    <div data-slot="compact-row-text" class="flex min-w-0 flex-1 flex-col">
      <div data-slot="compact-row-title-line" class="flex h-5 min-w-0 items-center">
        <slot name="title" />
      </div>
      <div data-slot="compact-row-meta" :class="metaLine">
        <slot name="meta" />
      </div>
    </div>
    <div
      v-if="$slots.trailing"
      data-slot="compact-row-trailing"
      :class="
        cn(
          'flex shrink-0 items-center gap-2',
          (selected || revealed) && $slots.actions && 'max-sm:hidden',
        )
      "
    >
      <slot name="trailing" />
    </div>
    <div
      v-if="$slots.actions"
      data-slot="compact-row-actions"
      :class="
        cn(
          'shrink-0 items-center gap-1',
          // Out under the pointer, with keyboard focus inside the row, and while a menu opened
          // from the row is open (the pointer has left the row for the menu by then).
          selected || revealed
            ? 'flex'
            : [
                'hidden',
                'group-hover/row:flex group-has-[:focus-visible]/row:flex group-has-[[aria-expanded=true]]/row:flex',
              ],
        )
      "
    >
      <slot name="actions" />
    </div>
  </Primitive>
</template>
