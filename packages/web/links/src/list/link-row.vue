<script setup lang="ts">
import type * as Link from "@stash/contracts-domain/link";
import type * as Tag from "@stash/contracts-domain/tag";
import * as TermHighlight from "@stash/web-search/term-highlight";
import MatchMark from "@stash/web-ui/match-mark";
import MediaRow from "@stash/web-ui/media-row";
import MediaRowTitle from "@stash/web-ui/media-row-title";
import MediaThumb from "@stash/web-ui/media-thumb";
import TagChip from "@stash/web-ui/tag-chip";
import type * as DateTime from "effect/DateTime";
import { computed } from "vue";
import { type RouteLocationRaw, RouterLink } from "vue-router";
import LinkActions from "../link-actions.vue";
import * as LinkDisplay from "../link-display.ts";

// One link as a media row: preview · title · host · channel or author · age · device, then the
// summary when there is one and at most three tags. The whole row opens the link's page. As a
// search result it is the same row, with the query's terms marked in the title and the summary.
const props = defineProps<{
  link: Link.Link;
  selected: boolean;
  /** The name of the device the link was saved from, if known. */
  device: string | undefined;
  now: DateTime.Utc;
  /** Where a tag on the row goes: the list, narrowed to that tag. */
  tagTo: (tag: Tag.TagName) => RouteLocationRaw;
  /** The query whose terms the title and summary mark, or `""` for none. */
  highlight?: string;
}>();
const emit = defineEmits<{ select: []; open: [] }>();

const title = computed(() =>
  TermHighlight.split(LinkDisplay.title(props.link), props.highlight ?? ""),
);
const summary = computed(() =>
  TermHighlight.split(props.link.summary ?? "", props.highlight ?? ""),
);

const tags = computed(() => LinkDisplay.shownTags(props.link.tags));
</script>

<template>
  <MediaRow
    as="li"
    :selected="selected"
    :unread="link.status === 'new'"
    data-slot="link-row"
    v-bind="{
      'aria-current': selected ? true : undefined,
      onClick: () => emit('select'),
    }"
  >
    <template #thumb>
      <MediaThumb
        :src="link.imageUrl"
        :url="link.url"
        :initial="LinkDisplay.domain(link)"
        :video="link.type === 'video'"
      />
    </template>
    <template #title>
      <MediaRowTitle as-child>
        <RouterLink :to="{ name: 'link-details', params: { id: link.id } }" @click="emit('open')">
          <template v-for="(part, i) in title" :key="i">
            <MatchMark v-if="part.match" tone="signal">{{ part.text }}</MatchMark>
            <template v-else>{{ part.text }}</template>
          </template>
        </RouterLink>
      </MediaRowTitle>
    </template>
    <template #meta>
      <a
        :href="link.url"
        target="_blank"
        rel="noopener noreferrer"
        data-slot="link-host"
        class="relative hover:text-foreground"
        @click.stop
        >{{ LinkDisplay.domain(link) }}</a
      >
      <span v-if="link.author !== null" data-slot="link-author" data-shrink="">{{
        link.author
      }}</span>
      <span>{{ LinkDisplay.age(link.createdAt, now) }}</span>
      <span v-if="device !== undefined" data-slot="link-device" class="max-sm:hidden">{{
        device
      }}</span>
    </template>
    <p v-if="link.enrichedAt === null" class="text-meta text-muted-foreground">summarizing…</p>
    <p
      v-else-if="link.summary"
      data-slot="link-summary"
      class="line-clamp-2 text-body text-muted-foreground"
    >
      <template v-for="(part, i) in summary" :key="i">
        <MatchMark v-if="part.match" tone="signal">{{ part.text }}</MatchMark>
        <template v-else>{{ part.text }}</template>
      </template>
    </p>
    <div v-if="tags.shown.length > 0" class="flex flex-wrap items-center gap-1">
      <TagChip v-for="tag in tags.shown" :key="tag" as-child>
        <RouterLink :to="tagTo(tag)" replace data-filter="tag" @click.stop> #{{ tag }} </RouterLink>
      </TagChip>
      <TagChip v-if="tags.more > 0" data-slot="more-tags">+{{ tags.more }}</TagChip>
    </div>
    <template #actions>
      <LinkActions :link="link" shortcuts />
    </template>
  </MediaRow>
</template>
