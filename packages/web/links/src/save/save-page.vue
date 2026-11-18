<script setup lang="ts">
import * as AtomVue from "@effect/atom-vue";
import { TriangleAlert } from "@lucide/vue";
import Button from "@stash/web-ui/button";
import EmptyState from "@stash/web-ui/empty-state";
import MediaRow from "@stash/web-ui/media-row";
import MediaRowTitle from "@stash/web-ui/media-row-title";
import MediaThumb from "@stash/web-ui/media-thumb";
import PageHeader from "@stash/web-ui/page-header";
import type * as Link from "@stash/contracts-domain/link";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import { onMounted, ref } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import * as LinksAtoms from "../links-atoms.ts";
import * as SaveRequest from "./save-request.ts";

// `/save?…&url=<url>`: saves the link once, as soon as the page opens (signed in: the auth guard
// sends a signed-out visitor to the login page and back here), and says how it went: the saved
// link as the media row it is in the Inbox, with Back and Undo under it.

const route = useRoute();
const router = useRouter();
const save = AtomVue.useAtomSet(() => LinksAtoms.saveRequested, { mode: "promiseExit" });

type View =
  | { readonly state: "saving" }
  | {
      readonly state: "saved";
      readonly title: string;
      readonly host: string;
      readonly link: Link.Link;
      /** Saved by this request, not before: only then can Undo delete it. */
      readonly fresh: boolean;
    }
  | { readonly state: "undone"; readonly host: string }
  | { readonly state: "invalid" }
  | { readonly state: "failed"; readonly message: string };

const view = ref<View>({ state: "saving" });

const host = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

onMounted(async () => {
  const request = SaveRequest.parse(route.fullPath);
  if (request === undefined) {
    view.value = { state: "invalid" };
    return;
  }
  const exit = await save(request);
  view.value = Exit.isSuccess(exit)
    ? {
        state: "saved",
        title: exit.value.title ?? request.title ?? host(request.url),
        host: host(exit.value.url),
        link: exit.value,
        // The api says whether this save stored the link. A repeat save answers the stored one.
        fresh: exit.value.created,
      }
    : {
        state: "failed",
        message: Option.exists(Exit.findErrorOption(exit), (error) => error._tag === "RateLimited")
          ? "Too many saves at once. Wait a minute and try again."
          : "Stash could not save this link. Try again.",
      };
});

// Any page can send the owner here, so the saved link's host shows and Undo deletes it in one tap.
const remove = AtomVue.useAtomSet(() => LinksAtoms.remove, { mode: "promiseExit" });
const undoing = ref(false);
const undoError = ref<string>();
const undo = async () => {
  const current = view.value;
  if (current.state !== "saved" || undoing.value) return;
  undoing.value = true;
  undoError.value = undefined;
  const exit = await remove(current.link.id);
  undoing.value = false;
  if (Exit.isSuccess(exit)) view.value = { state: "undone", host: current.host };
  else undoError.value = "Couldn't remove the link. Try again.";
};

// Opened by a Shortcut or bookmarklet, the page may have no history of its own. vue-router keeps
// the previous entry of this tab in its history state.
const back = () =>
  router.options.history.state["back"] == null ? router.push({ name: "links" }) : router.back();
</script>

<template>
  <section class="flex flex-col gap-6" aria-live="polite">
    <div v-if="view.state === 'saving'" aria-busy="true"><EmptyState title="Saving…" /></div>
    <template v-else-if="view.state === 'saved'">
      <PageHeader :title="`${view.fresh ? 'Saved' : 'Already saved'} ✓`" />
      <ul class="flex flex-col">
        <MediaRow as="li" data-slot="saved-link">
          <template #thumb>
            <MediaThumb
              :src="view.link.imageUrl"
              :initial="view.host"
              :video="view.link.type === 'video'"
            />
          </template>
          <template #title>
            <MediaRowTitle as-child>
              <RouterLink :to="{ name: 'link-details', params: { id: view.link.id } }">
                {{ view.title }}
              </RouterLink>
            </MediaRowTitle>
          </template>
          <template #meta>
            <span>{{ view.host }}</span>
            <span v-if="view.link.author !== null" data-shrink="">{{ view.link.author }}</span>
          </template>
          <p v-if="view.link.summary" class="line-clamp-2 text-body text-muted-foreground">
            {{ view.link.summary }}
          </p>
        </MediaRow>
      </ul>
      <p v-if="undoError" role="alert" class="text-meta text-destructive">{{ undoError }}</p>
      <div class="flex flex-wrap gap-2">
        <Button as-child variant="primary">
          <button type="button" data-action="back" @click="back">Back</button>
        </Button>
        <Button v-if="view.fresh" as-child>
          <button type="button" data-action="undo" :disabled="undoing" @click="undo">
            {{ undoing ? "Removing…" : "Undo" }}
          </button>
        </Button>
        <Button as-child><RouterLink :to="{ name: 'links' }">Open Inbox</RouterLink></Button>
      </div>
    </template>
    <EmptyState v-else-if="view.state === 'undone'" title="Removed" :description="view.host">
      <template #action>
        <Button as-child variant="primary">
          <button type="button" data-action="back" @click="back">Back</button>
        </Button>
      </template>
    </EmptyState>
    <div v-else role="alert">
      <EmptyState
        :title="view.state === 'invalid' ? 'Nothing to save' : 'Not saved'"
        :description="
          view.state === 'invalid'
            ? 'This address names no http(s) link. Open it as /save?url=<link>.'
            : view.message
        "
      >
        <template #icon><TriangleAlert aria-hidden="true" /></template>
        <template #action>
          <Button as-child variant="primary">
            <button type="button" data-action="back" @click="back">Back</button>
          </Button>
        </template>
      </EmptyState>
    </div>
  </section>
</template>
