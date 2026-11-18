<script setup lang="ts">
import type * as Link from "@stash/contracts-domain/link";
import type * as Tag from "@stash/contracts-domain/tag";
import * as TermHighlight from "@stash/web-search/term-highlight";
import MatchMark from "@stash/web-ui/match-mark";
import MediaRow from "@stash/web-ui/media-row";
import MediaRowTitle from "@stash/web-ui/media-row-title";
import MediaThumb from "@stash/web-ui/media-thumb";
import TagChip from "@stash/web-ui/tag-chip";
import TagLine from "@stash/web-ui/tag-line";
import type * as DateTime from "effect/DateTime";
import { computed } from "vue";
import { type RouteLocationRaw, RouterLink } from "vue-router";
import PostByline from "@stash/web-ui/post-byline";
import LinkActions from "../link-actions.vue";
import * as LinkDisplay from "../link-display.ts";
import * as PostDisplay from "../post-display.ts";

// One link as a media row, the same height for every link: preview · title (without the site's
// name) · host · channel or author · age · device, then one line of summary (or who published it)
// and one line of tags. A link still being enriched says `summarizing…` on the summary line, and
// on phones, which have none, at the end of the meta line. The whole row opens the link's page. As a search result it is the same
// row, with the query's terms marked in the title and the summary.
//
// A post on X is the same row in a post's order (#170): the author's picture, name and @handle
// lead the meta line, on top, and the post's own words take the two lines under it, where other
// rows have a title and a summary. Its preview is its first photo or its video's poster, else
// the author's picture on the generated cover.
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

const post = computed(() => PostDisplay.available(props.link));
const image = computed(() => LinkDisplay.image(props.link));
const title = computed(() =>
  TermHighlight.split(
    post.value === undefined ? LinkDisplay.rowTitle(props.link) : PostDisplay.rowText(post.value),
    props.highlight ?? "",
  ),
);
const summary = computed(() =>
  TermHighlight.split(LinkDisplay.rowSummary(props.link), props.highlight ?? ""),
);
</script>

<template>
  <MediaRow
    as="li"
    :selected="selected"
    :unread="link.status === 'new'"
    :meta-first="post !== undefined"
    data-slot="link-row"
    :data-post="post === undefined ? undefined : ''"
    v-bind="{
      'aria-current': selected ? true : undefined,
      onClick: () => emit('select'),
    }"
  >
    <template #thumb>
      <MediaThumb
        :src="image"
        :url="link.url"
        :initial="LinkDisplay.domain(link)"
        :video="
          post === undefined
            ? link.type === 'video'
            : image !== null && PostDisplay.startsWithVideo(post)
        "
        :avatar="
          post === undefined || image !== null
            ? undefined
            : { src: PostDisplay.avatar(post.author, 'large'), name: post.author.name }
        "
      />
    </template>
    <template #title>
      <MediaRowTitle as-child :lines="post === undefined ? 1 : 2">
        <RouterLink
          :to="{ name: 'link-details', params: { id: link.id } }"
          :title="post === undefined ? LinkDisplay.title(link) : post.text"
          :data-post-text="post === undefined ? undefined : ''"
          @click="emit('open')"
        >
          <template v-for="(part, i) in title" :key="i">
            <MatchMark v-if="part.match" tone="signal">{{ part.text }}</MatchMark>
            <template v-else>{{ part.text }}</template>
          </template>
        </RouterLink>
      </MediaRowTitle>
    </template>
    <template #meta>
      <PostByline
        v-if="post !== undefined"
        size="row"
        :name="post.author.name"
        :handle="post.author.handle"
        :avatar="PostDisplay.avatar(post.author)"
        :verified="post.author.verified"
      />
      <a
        v-else
        :href="link.url"
        target="_blank"
        rel="noopener noreferrer"
        data-slot="link-host"
        class="relative hover:text-foreground"
        @click.stop
        >{{ LinkDisplay.domain(link) }}</a
      >
      <span
        v-if="post === undefined && link.author !== null"
        data-slot="link-author"
        data-shrink=""
        >{{ link.author }}</span
      >
      <span>{{ LinkDisplay.age(link.createdAt, now) }}</span>
      <!-- Phones have no summary line, so the row says it here. -->
      <span v-if="link.enrichedAt === null" data-slot="link-summarizing-meta" class="sm:hidden"
        >summarizing…</span
      >
      <span v-if="device !== undefined" data-slot="link-device" class="max-sm:hidden">{{
        device
      }}</span>
    </template>
    <template #summary>
      <span v-if="link.enrichedAt === null" data-slot="link-summarizing">summarizing…</span>
      <span v-else-if="summary.length > 0" data-slot="link-summary">
        <template v-for="(part, i) in summary" :key="i">
          <MatchMark v-if="part.match" tone="signal">{{ part.text }}</MatchMark>
          <template v-else>{{ part.text }}</template>
        </template>
      </span>
    </template>
    <template #tags>
      <TagLine :tags="link.tags" :max="LinkDisplay.maxRowTags">
        <template #tag="{ tag }">
          <TagChip as-child>
            <RouterLink :to="tagTo(tag)" replace data-filter="tag" @click.stop>
              #{{ tag }}
            </RouterLink>
          </TagChip>
        </template>
      </TagLine>
    </template>
    <template #actions>
      <LinkActions :link="link" shortcuts />
    </template>
  </MediaRow>
</template>
