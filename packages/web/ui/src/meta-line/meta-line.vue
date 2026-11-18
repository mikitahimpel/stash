<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { cn } from "../cn";

// One line of metadata outside a row (a link's page: host · author · age · device): muted 13,
// its items separated by a middle dot, never wrapping. As in a `<MediaRow>`'s meta line, only an
// item marked `data-shrink` (a channel, an author) gives way on a narrow screen; the first item
// (the host) stays whole, and truncates only when nothing is left of the author.
const props = defineProps<{ class?: HTMLAttributes["class"] }>();
</script>

<template>
  <div
    data-slot="meta-line"
    :class="
      cn(
        'flex min-w-0 items-center overflow-hidden text-meta whitespace-nowrap text-muted-foreground [&>*]:shrink-0 [&>[data-shrink]]:min-w-0 [&>[data-shrink]]:shrink-[1000000] [&>[data-shrink]]:truncate [&>*+*]:before:mx-1.5 [&>*+*]:before:content-[\'·\'] [&>*:first-child]:min-w-0 [&>*:first-child]:shrink [&>*:first-child]:truncate',
        props.class,
      )
    "
  >
    <slot />
  </div>
</template>
