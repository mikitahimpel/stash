<script setup lang="ts">
import { Primitive, type PrimitiveProps } from "reka-ui";
import LogoMark from "../logo/logo-mark.vue";

const props = withDefaults(defineProps<PrimitiveProps & { size?: "md" | "xl" }>(), {
  as: "span",
  size: "md",
});

// The logo: the Well mark and `stash` in Geist 600, tracking -0.05em. `md` is the app bar (28px
// mark, 21px word), `xl` the login screen (44px mark, 38px word). `as-child` puts it on a
// RouterLink, which then gets the mark and the word as its children.
</script>

<template>
  <Primitive
    data-slot="wordmark"
    :data-size="props.size"
    :as="props.as"
    :as-child="props.asChild"
    class="inline-flex shrink-0 items-center gap-2.5 text-[21px] leading-none font-semibold tracking-[-0.05em] text-foreground data-[size=xl]:gap-3.5 data-[size=xl]:text-[38px]"
  >
    <slot>
      <LogoMark :size="props.size === 'xl' ? 'md' : 'sm'" />
      <span>stash</span>
    </slot>
  </Primitive>
</template>
