<script setup lang="ts">
import * as PopupLink from "@stash/ext-popup/popup-link";
import type * as PopupView from "@stash/ext-popup/popup-view";
import { computed, nextTick, onMounted, reactive, ref } from "vue";
import type * as PopupActions from "./popup-actions.ts";

// The toolbar popup: this page with Save (or Saved and Undo), a search field and Open Stash, the
// latest saved links and the connection. It only shows state and calls `actions`; the logic is in
// `@stash/ext-popup`. The rows follow the media rows of the web app: a thumb, a title and one
// muted line.
const props = defineProps<{ actions: PopupActions.Actions }>();

const page = ref<PopupView.Page | null>(null);
const view = ref<PopupView.View | null>(null);
const saved = ref<PopupLink.PopupLink | null>(null);
const recent = ref<ReadonlyArray<PopupLink.PopupLink>>([]);
const busy = ref(false);
const error = ref<string | null>(null);
// True while the popup polls a saved link for its tags.
const tagging = ref(false);
const query = ref("");
const now = Date.now();

const connection = computed(() => view.value?.connection ?? null);
const paired = computed(() => connection.value !== null && connection.value._tag !== "NotPaired");
const webOrigin = computed(() =>
  connection.value === null || connection.value._tag === "NotPaired"
    ? null
    : connection.value.webOrigin,
);
const status = computed(() => {
  switch (connection.value?._tag) {
    case "Connected":
      return { tone: "ok", text: connection.value.deviceName ?? "Connected" };
    case "Unreachable":
      return { tone: "warn", text: "Can't reach Stash" };
    case "NotPaired":
      return { tone: "off", text: "Not connected" };
    default:
      return null;
  }
});

// Images that failed to load fall back to the tile with an initial.
const broken = reactive(new Set<string>());
const usable = (url: string | null | undefined) =>
  url !== null && url !== undefined && !broken.has(url) ? url : null;
const initial = (host: string) => host.slice(0, 1);

// Save, or Connect: the buttons that may hold the focus, so Enter saves (or connects).
const primary = ref<HTMLButtonElement | null>(null);
const field = ref<HTMLInputElement | null>(null);
const keep = ref<HTMLButtonElement | null>(null);
// Removing is a hard delete, so the focus never lands on it: once the page is in Stash the focus
// goes to the search field, and Undo or Remove takes a click or a Tab.
const focusNext = async () => {
  await nextTick();
  (saved.value === null ? primary.value : field.value)?.focus();
};

// The link this popup created with its own Save. Only that one has a one-click Undo; a link that
// was in Stash before has tags and history, so Remove asks first.
const createdHere = ref<PopupLink.PopupLink["id"] | null>(null);
const confirming = ref(false);

const replace = (link: PopupLink.PopupLink) => {
  if (saved.value?.id === link.id) saved.value = link;
  recent.value = recent.value.map((it) => (it.id === link.id ? link : it));
};

const follow = async (link: PopupLink.PopupLink) => {
  if (link.enriched) return;
  tagging.value = true;
  try {
    await props.actions.watch(link.id, replace);
  } finally {
    tagging.value = false;
  }
};

onMounted(async () => {
  const loading = props.actions.load();
  page.value = await props.actions.page();
  const loaded = await loading;
  view.value = loaded;
  saved.value = loaded.saved;
  recent.value = loaded.recent;
  void focusNext();
  if (loaded.saved !== null) void follow(loaded.saved);
});

const save = async () => {
  busy.value = true;
  error.value = null;
  try {
    const result = await props.actions.save();
    if (result._tag === "Failed") {
      error.value = result.message;
      return;
    }
    saved.value = result.link;
    createdHere.value = result.created ? result.link.id : null;
    recent.value = [result.link, ...recent.value.filter((it) => it.id !== result.link.id)].slice(
      0,
      Math.max(recent.value.length, 1),
    );
    void follow(result.link);
  } finally {
    busy.value = false;
    void focusNext();
  }
};

const askToRemove = async () => {
  confirming.value = true;
  await nextTick();
  keep.value?.focus();
};
const keepIt = () => {
  confirming.value = false;
  void focusNext();
};

/** Deletes the page's link. The template reaches it from Undo, or from the confirmed Remove. */
const remove = async () => {
  const link = saved.value;
  if (link === null) return;
  busy.value = true;
  error.value = null;
  try {
    const result = await props.actions.undo(link.id);
    if (result._tag === "Failed") {
      error.value = result.message;
      return;
    }
    saved.value = null;
    createdHere.value = null;
    recent.value = recent.value.filter((it) => it.id !== link.id);
  } finally {
    busy.value = false;
    confirming.value = false;
    void focusNext();
  }
};

// A held Enter repeats: after it saved, it must not go on to submit the search.
const ignoreRepeat = (event: KeyboardEvent) => {
  if (event.repeat) event.preventDefault();
};
const search = () => {
  if (webOrigin.value !== null) void props.actions.search(webOrigin.value, query.value);
};
const openStash = () => {
  if (webOrigin.value !== null) void props.actions.openStash(webOrigin.value);
};
</script>

<template>
  <main class="popup">
    <header class="bar">
      <span class="brand">Stash</span>
      <span v-if="status" class="status" role="status">
        <span :class="['dot', status.tone]" aria-hidden="true" />
        <span class="status-text">{{ status.text }}</span>
      </span>
    </header>

    <section class="card" aria-label="This page">
      <div v-if="page" class="row">
        <span class="thumb">
          <img
            v-if="usable(saved?.imageUrl)"
            class="thumb-image"
            :src="usable(saved?.imageUrl) ?? undefined"
            alt=""
            @error="broken.add(saved?.imageUrl ?? '')"
          />
          <img
            v-else-if="usable(page.favIconUrl)"
            class="thumb-icon"
            :src="usable(page.favIconUrl) ?? undefined"
            alt=""
            @error="broken.add(page.favIconUrl ?? '')"
          />
          <span v-else aria-hidden="true">{{ initial(page.host) }}</span>
        </span>
        <span class="row-text">
          <span class="row-title">{{ page.title }}</span>
          <span class="meta">{{ page.host || "Not a web page" }}</span>
        </span>
      </div>

      <ul v-if="saved && saved.tags.length > 0" class="tags" aria-label="Tags">
        <li v-for="tag in saved.tags" :key="tag" class="tag">{{ tag }}</li>
      </ul>
      <p v-else-if="saved && tagging" class="meta" role="status">Tagging…</p>

      <template v-if="view === null">
        <button class="button tactile-primary wide" type="button" disabled>Save</button>
      </template>
      <template v-else-if="!paired">
        <p class="meta">Connect this browser to save pages and see your recent links here.</p>
        <button
          ref="primary"
          class="button tactile-primary wide"
          type="button"
          @click="props.actions.connect()"
        >
          Connect this browser
        </button>
      </template>
      <div v-else-if="saved && confirming" class="saved-row" role="group" aria-labelledby="ask">
        <span id="ask" class="saved">Remove from Stash?</span>
        <span class="choices">
          <button ref="keep" class="button tactile-raised" type="button" @click="keepIt">
            Keep
          </button>
          <button
            class="button tactile-raised danger"
            type="button"
            :disabled="busy"
            name="confirm-remove"
            @click="remove"
          >
            Remove
          </button>
        </span>
      </div>
      <div v-else-if="saved" class="saved-row">
        <span class="saved" role="status"><span aria-hidden="true">✓</span> Saved</span>
        <button
          v-if="saved.id === createdHere"
          class="button tactile-raised"
          type="button"
          :disabled="busy"
          name="undo"
          @click="remove"
        >
          Undo
        </button>
        <button
          v-else
          class="button tactile-raised"
          type="button"
          :disabled="busy"
          name="remove"
          @click="askToRemove"
        >
          Remove
        </button>
      </div>
      <template v-else>
        <button
          ref="primary"
          class="button tactile-primary wide"
          type="button"
          :disabled="busy || !page?.savable"
          @click="save"
        >
          {{ busy ? "Saving…" : "Save" }}
        </button>
        <p v-if="page && !page.savable" class="meta">Only http(s) pages can be saved.</p>
      </template>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
    </section>

    <form v-if="webOrigin" class="tools" role="search" @submit.prevent="search">
      <input
        ref="field"
        v-model="query"
        class="field tactile-sunken"
        type="search"
        placeholder="Search Stash"
        aria-label="Search Stash"
        autocomplete="off"
        @keydown.enter="ignoreRepeat"
      />
      <button class="button tactile-raised" type="button" @click="openStash">Open Stash</button>
    </form>

    <section v-if="recent.length > 0" aria-labelledby="recent-title">
      <div class="group-header">
        <h2 id="recent-title">Recent</h2>
        <span class="rule" aria-hidden="true" />
      </div>
      <ul class="recent">
        <li v-for="link in recent" :key="link.id">
          <a class="row link" :href="link.url" @click.prevent="props.actions.openLink(link.url)">
            <span class="thumb small">
              <img
                v-if="usable(link.imageUrl)"
                class="thumb-image"
                :src="usable(link.imageUrl) ?? undefined"
                alt=""
                @error="broken.add(link.imageUrl ?? '')"
              />
              <span v-else aria-hidden="true">{{ initial(link.host) }}</span>
            </span>
            <span class="row-text">
              <span class="row-title one-line">{{ link.title }}</span>
              <span class="meta">
                <span class="host">{{ link.host }}</span>
                <span>{{ PopupLink.age(link.savedAt, now) }}</span>
              </span>
            </span>
          </a>
        </li>
      </ul>
    </section>
    <p v-else-if="connection?._tag === 'Connected'" class="meta empty">Nothing saved yet.</p>
  </main>
</template>

<!-- The shared tokens and tactile classes, for the whole page. -->
<style src="../../assets/tokens.css"></style>

<style scoped>
.popup {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 380px;
  padding: 12px;
}

.bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 24px;
  padding-inline: 4px;
}
.brand {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.status {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
  color: var(--muted-foreground);
  font-size: 13px;
}
.status-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dot {
  width: 6px;
  height: 6px;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--muted-foreground);
}
.dot.ok {
  background: #2e9e5b;
}
.dot.warn {
  background: var(--signal);
}

.card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-surface);
  background: var(--surface);
}

/* A media row: thumb, then a title over one muted line. */
.row {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  gap: 12px;
}
.row-text {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 2px;
}
.row-title {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  font-size: 15px;
  font-weight: 600;
  line-height: 20px;
  overflow-wrap: anywhere;
}
.row-title.one-line {
  display: block;
  font-size: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.meta {
  display: flex;
  min-width: 0;
  margin: 0;
  color: var(--muted-foreground);
  font-size: 13px;
  line-height: 20px;
}
.meta > .host {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.meta > * + *::before {
  margin-inline: 6px;
  content: "·";
}

.thumb {
  position: relative;
  display: flex;
  width: 88px;
  height: 50px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: var(--radius-control);
  background: var(--sunken);
  color: var(--muted-foreground);
  font-size: 15px;
  font-weight: 600;
  text-transform: uppercase;
}
.thumb::after {
  position: absolute;
  inset: 0;
  border: 1px solid color-mix(in srgb, var(--foreground) 10%, transparent);
  border-radius: inherit;
  content: "";
}
.thumb.small {
  width: 64px;
  height: 36px;
  font-size: 13px;
}
.thumb-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.thumb-icon {
  width: 20px;
  height: 20px;
}

.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.tag {
  display: inline-flex;
  height: 24px;
  align-items: center;
  padding-inline: 8px;
  border-radius: var(--radius-control);
  background: var(--pressed);
  color: var(--muted-foreground);
  font-size: 13px;
  white-space: nowrap;
}

.button {
  display: inline-flex;
  height: var(--control-md);
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  padding-inline: 14px;
  border-radius: var(--radius-control);
  font: inherit;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
}
.button:disabled {
  cursor: default;
  opacity: 0.5;
}
.button.wide {
  width: 100%;
}

.saved-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.saved {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 500;
}
.choices {
  display: flex;
  gap: 8px;
}
.button.danger {
  color: var(--destructive);
}
.error {
  margin: 0;
  color: var(--destructive);
  font-size: 13px;
}

.tools {
  display: flex;
  gap: 8px;
}
.field {
  min-width: 0;
  height: var(--control-md);
  flex: 1;
  padding-inline: 12px;
  border-radius: var(--radius-control);
  color: var(--foreground);
  font: inherit;
}
.field::placeholder {
  color: var(--muted-foreground);
  opacity: 1;
}

.group-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-inline: 4px;
}
.group-header h2 {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.06em;
  line-height: 20px;
  text-transform: uppercase;
}
.rule {
  height: 1px;
  flex: 1;
  background: var(--hairline);
}
.recent {
  display: flex;
  flex-direction: column;
  margin: 4px 0 0;
  padding: 0;
  list-style: none;
}
.link {
  align-items: center;
  padding: 6px 4px;
  border-radius: var(--radius-control);
  color: inherit;
  text-decoration: none;
}
.link:hover {
  background: var(--surface);
}
.empty {
  padding-inline: 4px;
}
</style>
