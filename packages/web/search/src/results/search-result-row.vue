<script setup lang="ts">
import type * as Link from "@stash/contracts-domain/link";
import ListRow from "@stash/web-ui/list-row";
import TextLink from "@stash/web-ui/text-link";
import * as DateTime from "effect/DateTime";
import { computed } from "vue";
import * as TermHighlight from "./term-highlight.ts";

// A row of its own: the search page doesn't depend on `@stash/web-links`.
const props = defineProps<{
  link: Link.Link;
  /** 1 for the best match. */
  rank: number;
  selected: boolean;
  /** The query whose terms the summary highlights, or `""` for none (meaning search). */
  highlight: string;
}>();

const meta = computed(() =>
  [
    props.link.language,
    props.link.type,
    DateTime.formatIso(props.link.createdAt).slice(0, 10),
    props.link.status === "new" ? null : props.link.status,
  ]
    .filter((part) => part !== null)
    .join(" · "),
);
const summary = computed(() =>
  props.link.summary === null ? [] : TermHighlight.split(props.link.summary, props.highlight),
);
</script>

<template>
  <ListRow as="li" :selected="selected" class="flex-row items-start gap-3">
    <span
      class="w-6 shrink-0 pt-0.5 text-right font-mono text-xs text-signal tabular-nums"
      aria-hidden="true"
      >{{ rank }}</span
    >
    <div class="flex min-w-0 flex-1 flex-col gap-1">
      <TextLink
        v-bind="{
          href: link.url,
          target: '_blank',
          rel: 'noopener noreferrer',
          'data-result-link': '',
        }"
        class="text-[15px] break-words"
      >
        {{ link.title ?? link.url }}
      </TextLink>
      <p class="font-mono text-xs text-muted-foreground">{{ meta }}</p>
      <p v-if="summary.length > 0" class="line-clamp-3 text-sm text-muted-foreground">
        <template v-for="(part, i) in summary" :key="i">
          <mark v-if="part.match" class="rounded-[3px] bg-surface px-0.5 text-foreground">{{
            part.text
          }}</mark>
          <template v-else>{{ part.text }}</template>
        </template>
      </p>
    </div>
  </ListRow>
</template>
