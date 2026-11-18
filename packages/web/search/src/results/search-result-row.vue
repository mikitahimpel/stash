<script setup lang="ts">
import type * as Link from "@stash/contracts-domain/link";
import MatchMark from "@stash/web-ui/match-mark";
import MediaRow from "@stash/web-ui/media-row";
import MediaRowTitle from "@stash/web-ui/media-row-title";
import MediaThumb from "@stash/web-ui/media-thumb";
import TagChip from "@stash/web-ui/tag-chip";
import * as DateTime from "effect/DateTime";
import { computed } from "vue";
import * as SearchRequest from "../search-request.ts";
import * as TermHighlight from "./term-highlight.ts";

// One link as a media row, the Inbox's look with the query's terms marked. A row of its own: the
// search page doesn't depend on `@stash/web-links`. The whole row opens the link.
const props = defineProps<{
  link: Link.Link;
  selected: boolean;
  /** The query whose terms the title and summary highlight, or `""` for none. */
  highlight: string;
  /** The name of the device the link was saved from, if known. */
  device: string | undefined;
  /** Epoch milliseconds. */
  now: number;
}>();
const emit = defineEmits<{ tag: [name: string] }>();

const title = computed(() =>
  TermHighlight.split(props.link.title ?? props.link.url, props.highlight),
);
const summary = computed(() =>
  props.link.summary === null ? [] : TermHighlight.split(props.link.summary, props.highlight),
);
const tags = computed(() => props.link.tags.slice(0, SearchRequest.maxRowTags));
const moreTags = computed(() => props.link.tags.length - tags.value.length);
</script>

<template>
  <MediaRow as="li" :selected="selected" :unread="link.status === 'new'">
    <template #thumb>
      <MediaThumb
        :src="link.imageUrl"
        :initial="SearchRequest.host(link)"
        :video="link.type === 'video'"
      />
    </template>
    <template #title>
      <MediaRowTitle as-child>
        <a :href="link.url" target="_blank" rel="noopener noreferrer" data-result-link="">
          <template v-for="(part, i) in title" :key="i">
            <MatchMark v-if="part.match" tone="signal">{{ part.text }}</MatchMark>
            <template v-else>{{ part.text }}</template>
          </template>
        </a>
      </MediaRowTitle>
    </template>
    <template #meta>
      <span>{{ SearchRequest.host(link) }}</span>
      <span v-if="link.author !== null" data-slot="result-author" data-shrink="">{{
        link.author
      }}</span>
      <span>{{ SearchRequest.age(DateTime.toEpochMillis(link.createdAt), now) }}</span>
      <span v-if="device !== undefined" data-slot="result-device" class="max-sm:hidden">{{
        device
      }}</span>
    </template>
    <p
      v-if="summary.length > 0"
      data-slot="result-summary"
      class="line-clamp-2 text-body text-muted-foreground"
    >
      <template v-for="(part, i) in summary" :key="i">
        <MatchMark v-if="part.match" tone="signal">{{ part.text }}</MatchMark>
        <template v-else>{{ part.text }}</template>
      </template>
    </p>
    <div v-if="tags.length > 0" class="flex flex-wrap items-center gap-1">
      <TagChip v-for="name in tags" :key="name" as-child>
        <button type="button" data-filter="tag" @click.stop="emit('tag', name)">#{{ name }}</button>
      </TagChip>
      <TagChip v-if="moreTags > 0" data-slot="more-tags">+{{ moreTags }}</TagChip>
    </div>
  </MediaRow>
</template>
