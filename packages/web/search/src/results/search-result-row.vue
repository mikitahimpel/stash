<script setup lang="ts">
import type * as Link from "@stash/contracts-domain/link";
import ListRow from "@stash/web-ui/list-row";
import ListRowTitle from "@stash/web-ui/list-row-title";
import MatchMark from "@stash/web-ui/match-mark";
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
  <ListRow as="li" :selected="selected">
    <template #leading>
      <span class="w-6 text-signal" aria-hidden="true">{{ rank }}</span>
    </template>
    <template #title>
      <ListRowTitle as-child>
        <a :href="link.url" target="_blank" rel="noopener noreferrer" data-result-link="">{{
          link.title ?? link.url
        }}</a>
      </ListRowTitle>
    </template>
    <template #meta>
      <span>{{ meta }}</span>
    </template>
    <p v-if="summary.length > 0" class="line-clamp-3 text-body text-muted-foreground">
      <template v-for="(part, i) in summary" :key="i">
        <MatchMark v-if="part.match">{{ part.text }}</MatchMark>
        <template v-else>{{ part.text }}</template>
      </template>
    </p>
  </ListRow>
</template>
