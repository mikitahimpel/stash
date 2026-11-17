<script setup lang="ts">
import Button from "@stash/web-ui/button";
import Kbd from "@stash/web-ui/kbd";
import MatchMark from "@stash/web-ui/match-mark";
import MediaRow from "@stash/web-ui/media-row";
import MediaRowTitle from "@stash/web-ui/media-row-title";
import MediaThumb from "@stash/web-ui/media-thumb";
import TagChip from "@stash/web-ui/tag-chip";
import { computed } from "vue";
import type { MockLink } from "./mockup-data.ts";

// One link as a media row: preview · title · host · channel or author · age · device · summary ·
// at most three tags. The Inbox and Search mockups share it, as the real pages would.
const props = withDefaults(
  defineProps<{ link: MockLink; selected?: boolean; highlight?: string }>(),
  { selected: false, highlight: "" },
);

const maxTags = 3;
const tags = computed(() => props.link.tags.slice(0, maxTags));
const moreTags = computed(() => props.link.tags.length - tags.value.length);

/** The text in pieces, the ones that match the query marked. */
const pieces = (text: string) => {
  const term = props.highlight.trim().toLowerCase();
  if (term === "") return [{ text, match: false }];
  const found: Array<{ text: string; match: boolean }> = [];
  let from = 0;
  for (;;) {
    const at = text.toLowerCase().indexOf(term, from);
    if (at === -1) break;
    if (at > from) found.push({ text: text.slice(from, at), match: false });
    found.push({ text: text.slice(at, at + term.length), match: true });
    from = at + term.length;
  }
  if (from < text.length) found.push({ text: text.slice(from), match: false });
  return found;
};

const actions = [
  { label: "Mark seen", key: "S" },
  { label: "Mark done", key: "D" },
  { label: "Archive", key: "E" },
] as const;
</script>

<template>
  <MediaRow as="li" :selected="selected" :unread="link.unread === true">
    <template #thumb>
      <MediaThumb :src="link.image" :initial="link.host" :video="link.video === true" />
    </template>
    <template #title>
      <MediaRowTitle as-child>
        <a :href="`#${link.id}`">
          <template v-for="(piece, index) in pieces(link.title)" :key="index">
            <MatchMark v-if="piece.match" tone="signal">{{ piece.text }}</MatchMark>
            <template v-else>{{ piece.text }}</template>
          </template>
        </a>
      </MediaRowTitle>
    </template>
    <template #meta>
      <span>{{ link.host }}</span>
      <span v-if="link.by !== undefined">{{ link.by }}</span>
      <span>{{ link.age }}</span>
      <span class="max-sm:hidden">{{ link.device }}</span>
    </template>
    <p v-if="link.summary !== undefined" class="line-clamp-2 text-body text-muted-foreground">
      <template v-for="(piece, index) in pieces(link.summary)" :key="index">
        <MatchMark v-if="piece.match" tone="signal">{{ piece.text }}</MatchMark>
        <template v-else>{{ piece.text }}</template>
      </template>
    </p>
    <div v-if="tags.length > 0" class="flex flex-wrap items-center gap-1">
      <TagChip v-for="tag in tags" :key="tag" as-child>
        <a :href="`#tag-${tag}`">#{{ tag }}</a>
      </TagChip>
      <TagChip v-if="moreTags > 0">+{{ moreTags }}</TagChip>
    </div>
    <template #actions>
      <Button v-for="action in actions" :key="action.label" as-child variant="ghost" size="sm">
        <button type="button">
          {{ action.label }} <Kbd>{{ action.key }}</Kbd>
        </button>
      </Button>
    </template>
  </MediaRow>
</template>
