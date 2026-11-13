<script setup lang="ts">
import { Primitive, type PrimitiveProps } from "reka-ui";

interface Props extends PrimitiveProps {
  /** The tab of the current page: underlined, full contrast. */
  active?: boolean;
  /** A keyboard hint after the label (`⌘K`), hidden on phones. */
  shortcut?: string;
}

const props = withDefaults(defineProps<Props>(), { as: "a", active: false });

// `as-child` puts the look on the `<a>` of a RouterLink.
</script>

<template>
  <Primitive
    data-slot="nav-tab"
    :as="props.as"
    :as-child="props.asChild"
    :class="[
      'inline-flex h-12 flex-1 items-center justify-center gap-2 border-b-2 text-label whitespace-nowrap transition-colors sm:h-full sm:flex-none',
      active
        ? 'border-foreground text-foreground'
        : 'border-transparent text-muted-foreground hover:text-foreground',
    ]"
  >
    <slot />
  </Primitive>
</template>
