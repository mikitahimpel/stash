<script setup lang="ts">
import { ChevronRight } from "@lucide/vue";
import type { HTMLAttributes } from "vue";
import { cn } from "../cn";

// The header of a group of rows (a day in the Inbox, a device on Open now): 13/600 uppercase with
// a muted count and a hairline rule to the content edge (or to its `actions`, `ghost` `sm` buttons
// that end on the edge). It sits between the page title and the row titles: stronger than a row,
// quieter than the page.
//
// `collapsible` makes the title a 32px button with a chevron that folds the group
// (`v-model:open`); the header is then 32px tall whether it has actions or not. `sticky` keeps it
// under the app header while its group scrolls by.
const props = withDefaults(
  defineProps<{
    title?: string;
    count?: number | string;
    /** A muted remark after the count, in sentence case: `synced just now`. */
    meta?: string;
    /** A group that is still loading: a bar where the title goes, on the same line box. */
    placeholder?: boolean;
    collapsible?: boolean;
    sticky?: boolean;
    as?: "h2" | "h3" | "h4";
    class?: HTMLAttributes["class"];
  }>(),
  { as: "h2", title: "", meta: "", placeholder: false, collapsible: false, sticky: false },
);
/** Whether a `collapsible` group shows its rows. */
const open = defineModel<boolean>("open", { default: true });

defineSlots<{ actions?: () => unknown }>();
</script>

<template>
  <div
    data-slot="group-header"
    :data-sticky="sticky ? '' : undefined"
    :class="
      cn(
        'flex flex-wrap items-center gap-x-3 gap-y-2',
        collapsible && 'min-h-control-sm',
        sticky && 'sticky top-(--app-bar-height) z-[5] bg-background',
        props.class,
      )
    "
  >
    <!-- The title and its rule stay on one line (a long title is cut). On phones the actions have
         a line of their own under it. -->
    <div
      :class="['flex min-w-0 flex-1 items-center gap-x-3', $slots.actions && 'max-sm:basis-full']"
    >
      <component
        :is="as"
        :class="[
          'flex min-w-0 shrink gap-2 text-meta font-semibold tracking-[0.06em] text-foreground uppercase',
          // The toggle is a 32px box: the count and the remark sit on its centre line.
          collapsible ? 'items-center' : 'items-baseline',
        ]"
      >
        <span
          v-if="placeholder"
          data-slot="group-header-placeholder"
          aria-hidden="true"
          class="flex h-5 items-center"
          ><span class="h-3 w-20 animate-pulse rounded-sm bg-hairline"
        /></span>
        <button
          v-else-if="collapsible"
          type="button"
          data-slot="group-header-toggle"
          :aria-expanded="open"
          class="relative hit-area flex h-control-sm min-w-0 items-center gap-1 rounded-control font-semibold tracking-[0.06em] uppercase outline-none focus-visible:outline-2 focus-visible:outline-ring/40"
          @click="open = !open"
        >
          <ChevronRight
            aria-hidden="true"
            :class="[
              'size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none',
              open && 'rotate-90',
            ]"
          />
          <span class="truncate">{{ title }}</span>
        </button>
        <template v-else>{{ title }}</template>
        <span
          v-if="count !== undefined"
          data-slot="group-header-count"
          class="shrink-0 font-normal tracking-normal text-muted-foreground normal-case tabular-nums"
          >{{ count }}</span
        >
        <span
          v-if="meta !== ''"
          data-slot="group-header-meta"
          class="min-w-0 shrink-[1000] truncate font-normal tracking-normal text-muted-foreground normal-case before:mr-2 before:content-['·']"
          >{{ meta }}</span
        >
      </component>
      <span aria-hidden="true" class="h-px min-w-4 flex-1 bg-hairline" />
    </div>
    <div
      v-if="$slots.actions"
      data-slot="group-header-actions"
      class="ml-auto flex shrink-0 items-center gap-2"
    >
      <slot name="actions" />
    </div>
  </div>
</template>
