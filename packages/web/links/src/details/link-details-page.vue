<script setup lang="ts">
import * as AtomVue from "@effect/atom-vue";
import { ArrowLeft, ExternalLink } from "@lucide/vue";
import type * as Link from "@stash/contracts-domain/link";
import Badge from "@stash/web-ui/badge";
import Button from "@stash/web-ui/button";
import Disclosure from "@stash/web-ui/disclosure";
import EmptyState from "@stash/web-ui/empty-state";
import ErrorState from "@stash/web-ui/error-state";
import MediaHero from "@stash/web-ui/media-hero";
import MetaLine from "@stash/web-ui/meta-line";
import Skeleton from "@stash/web-ui/skeleton";
import TagChip from "@stash/web-ui/tag-chip";
import { useDelayedLoading } from "@stash/web-ui/use-delayed-loading";
import * as DateTime from "effect/DateTime";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { computed, ref } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import LinkDeleteButton from "../link-delete-button.vue";
import * as LinkDisplay from "../link-display.ts";
import * as LinksAtoms from "../links-atoms.ts";
import CopyButton from "./copy-button.vue";
import * as LinkBack from "./link-back.ts";
import LinkDetailsActions from "./link-details-actions.vue";
import * as YoutubeEmbed from "./youtube-embed.ts";

// One link on its own page: the preview (a YouTube link plays in place), the title, one meta line
// with the primary Open, the summary as reading text, the tags, the status actions, and the rest
// (dates, language, URLs) folded away under Details. Delete stands apart at the end.
const registry = AtomVue.injectRegistry();
const route = useRoute();
const router = useRouter();

// `/links/:id` only matches a non-empty id.
const details = () => LinksAtoms.details(String(route.params.id) as Link.LinkId);
const result = AtomVue.useAtomValue(details);

const view = computed(() =>
  AsyncResult.match(result.value, {
    onInitial: () => ({ state: "loading" as const }),
    onFailure: (failure) =>
      failure.cause.reasons.some(
        (reason) => reason._tag === "Fail" && reason.error._tag === "NotFound",
      )
        ? { state: "missing" as const }
        : { state: "error" as const },
    onSuccess: ({ value }) => ({ state: "link" as const, link: value, now: DateTime.nowUnsafe() }),
  }),
);

// The skeleton only shows on a first load that takes a while (the link stays cached), and then
// for long enough not to flash. It has the article's own blocks: the preview, the kind, the title,
// the meta line with Open, and the summary.
const loading = useDelayedLoading(() => view.value.state === "loading");
const retry = () => registry.refresh(details());

// Where the page was opened from, read once: going back there keeps its filters and scroll.
const back = LinkBack.from(router);

const devices = AtomVue.useAtomValue(() => LinksAtoms.devices);
const deviceName = (link: Link.Link) =>
  link.sourceDeviceId === null || !AsyncResult.isSuccess(devices.value)
    ? undefined
    : devices.value.value.find((device) => device.id === link.sourceDeviceId)?.name;

const saved = (link: Link.Link, now: DateTime.Utc) => {
  const age = LinkDisplay.age(link.createdAt, now);
  return age === "now" ? "saved just now" : `saved ${age} ago`;
};

/** Type and status as one quiet label: `Video · New`. */
const kind = (link: Link.Link) =>
  [link.type === null ? undefined : LinkDisplay.typeLabels[link.type], statusLabels[link.status]]
    .filter((part) => part !== undefined)
    .join(" · ");
const statusLabels: Readonly<Record<Link.LinkStatus, string>> = {
  new: "New",
  seen: "Seen",
  done: "Done",
  archived: "Archived",
};

const formatDate = (date: DateTime.Utc) =>
  DateTime.format(DateTime.setZone(date, DateTime.zoneMakeLocal()), {
    dateStyle: "medium",
    timeStyle: "short",
    locale: "en",
  });

const deleteFailed = ref(false);
// After a delete the page has nothing to show: back to the Inbox it was opened from, with its
// filters or search, else to the Inbox.
const leave = () => (back.history ? router.back() : void router.replace({ name: "links" }));
</script>

<template>
  <section class="flex flex-col gap-6">
    <Button variant="secondary" size="sm" class="self-start" as-child>
      <button v-if="back.history" type="button" data-action="back" @click="router.back()">
        <ArrowLeft aria-hidden="true" /> {{ back.label }}
      </button>
      <RouterLink v-else :to="{ name: 'links' }" data-action="back">
        <ArrowLeft aria-hidden="true" /> {{ back.label }}
      </RouterLink>
    </Button>

    <div v-if="loading" class="flex max-w-3xl flex-col gap-6" aria-busy="true" data-state="loading">
      <Skeleton shape="hero" />
      <div class="flex flex-col gap-3">
        <Skeleton shape="badge" />
        <Skeleton shape="title" class="w-2/3" />
        <div class="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
          <Skeleton class="w-1/3" />
          <Skeleton shape="control" class="w-[86px] max-sm:w-full" />
        </div>
      </div>
      <div class="flex max-w-[65ch] flex-col">
        <Skeleton v-for="n in 3" :key="n" shape="prose" :class="n === 3 ? 'w-2/3' : 'w-full'" />
      </div>
    </div>
    <div v-else-if="view.state === 'loading'" aria-busy="true" />
    <EmptyState
      v-else-if="view.state === 'missing'"
      title="Link not found"
      description="It may have been deleted."
    />
    <ErrorState v-else-if="view.state === 'error'" title="Couldn't load the link" @retry="retry" />
    <article v-else class="flex max-w-3xl flex-col gap-6" data-slot="link-details">
      <MediaHero
        :src="LinkDisplay.image(view.link)"
        :url="view.link.url"
        :initial="LinkDisplay.domain(view.link)"
        :embed="YoutubeEmbed.player(view.link.url)"
        :title="LinkDisplay.title(view.link)"
      />

      <header class="flex flex-col gap-3">
        <Badge variant="outline" data-slot="link-kind">{{ kind(view.link) }}</Badge>
        <h1 class="line-clamp-3 text-title break-words">{{ LinkDisplay.title(view.link) }}</h1>
        <div class="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
          <MetaLine>
            <a
              :href="view.link.url"
              target="_blank"
              rel="noopener noreferrer"
              data-slot="link-host"
              class="hover:text-foreground"
              >{{ LinkDisplay.domain(view.link) }}</a
            >
            <span v-if="view.link.author !== null" data-slot="link-author" data-shrink="">{{
              view.link.author
            }}</span>
            <span data-slot="link-saved">{{ saved(view.link, view.now) }}</span>
            <span v-if="deviceName(view.link) !== undefined" data-slot="link-device">{{
              deviceName(view.link)
            }}</span>
          </MetaLine>
          <Button variant="primary" class="max-sm:w-full" as-child>
            <a :href="view.link.url" target="_blank" rel="noopener noreferrer" data-action="open">
              Open <ExternalLink aria-hidden="true" />
            </a>
          </Button>
        </div>
      </header>

      <p v-if="view.link.summary" data-slot="link-summary" class="max-w-[65ch] text-prose">
        {{ view.link.summary }}
      </p>
      <p v-else-if="view.link.enrichedAt === null" class="text-meta text-muted-foreground">
        summarizing…
      </p>

      <div v-if="view.link.tags.length > 0" class="flex flex-wrap items-center gap-2">
        <TagChip v-for="tag in view.link.tags" :key="tag" as-child>
          <RouterLink
            data-filter="tag"
            :to="{
              name: 'links',
              query: LinksAtoms.toQuery({ ...LinksAtoms.defaultFilters, tag }),
            }"
            >#{{ tag }}</RouterLink
          >
        </TagChip>
      </div>

      <LinkDetailsActions :link="view.link" />

      <Disclosure summary="Details">
        <dl class="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-1 text-meta">
          <dt class="text-muted-foreground">Saved</dt>
          <dd>{{ formatDate(view.link.createdAt) }}</dd>
          <template v-if="view.link.language !== null">
            <dt class="text-muted-foreground">Language</dt>
            <dd>{{ view.link.language }}</dd>
          </template>
          <dt class="text-muted-foreground">URL</dt>
          <dd class="flex min-w-0 items-center gap-2" data-slot="link-url">
            <span class="truncate">{{ view.link.url }}</span>
            <CopyButton label="URL" :value="view.link.url" />
          </dd>
          <template
            v-if="view.link.canonicalUrl !== null && view.link.canonicalUrl !== view.link.url"
          >
            <dt class="text-muted-foreground">Canonical URL</dt>
            <dd class="flex min-w-0 items-center gap-2" data-slot="link-canonical-url">
              <span class="truncate">{{ view.link.canonicalUrl }}</span>
              <CopyButton label="Canonical URL" :value="view.link.canonicalUrl" />
            </dd>
          </template>
        </dl>
      </Disclosure>

      <div class="flex flex-wrap items-center gap-3">
        <LinkDeleteButton
          v-model:failed="deleteFailed"
          :link="view.link"
          variant="destructive"
          :after-remove="leave"
        />
        <span v-if="deleteFailed" role="alert" class="text-meta text-destructive">
          That didn't work. Try again.
        </span>
      </div>
    </article>
  </section>
</template>
