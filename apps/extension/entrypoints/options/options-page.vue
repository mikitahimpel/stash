<script setup lang="ts">
import * as PopupLink from "@stash/ext-popup/popup-link";
import { computed, nextTick, onMounted, ref } from "vue";
import markUrl from "../../assets/stash-mark.svg";
import type * as OptionsActions from "./options-actions.ts";
import type * as OptionsView from "./options-view.ts";

// The options page: one card that connects this browser to Stash and then shows the connection.
// The normal path has nothing to type: the build knows its Stash (`build-origin.ts`), so there is
// one button. Another address, and a device token entered by hand, sit behind "Use a different
// Stash". The page only shows state and calls `actions`.
const props = defineProps<{ actions: OptionsActions.Actions }>();

const view = ref<OptionsView.View | null>(null);
const now = ref(Date.now());

/** While the page waits for the approval. `check` is the code the Stash tab shows too. */
const pairing = ref<{ check: string | null; cancel: () => void } | null>(null);
const error = ref<string | null>(null);

// "Use a different Stash": another address, and under it a token by hand.
const other = ref(false);
const address = ref("");
const addressField = ref<HTMLInputElement | null>(null);
const byHand = ref(false);
const apiBaseUrl = ref("");
const deviceToken = ref("");
const saving = ref(false);
const tokenError = ref<string | null>(null);

const syncing = ref(false);
const syncError = ref<string | null>(null);
const confirming = ref(false);
const keep = ref<HTMLButtonElement | null>(null);

const webOrigin = computed(() => view.value?.webOrigin ?? "");
/** `stash.example.com` of `https://stash.example.com`. */
const host = computed(() => webOrigin.value.replace(/^https?:\/\//, ""));
// A build without a built-in Stash has to ask for the address.
const needsAddress = computed(() => view.value?._tag === "NotPaired" && webOrigin.value === "");
const showOther = computed(() => pairing.value === null && (other.value || needsAddress.value));

const reload = async () => {
  view.value = await props.actions.load();
  now.value = Date.now();
};

onMounted(reload);

const connect = async (origin: string) => {
  const controller = new AbortController();
  const state = { check: null as string | null, cancel: () => controller.abort() };
  pairing.value = state;
  error.value = null;
  try {
    const result = await props.actions.connect(
      origin,
      (check) => {
        if (pairing.value !== null) pairing.value = { ...state, check };
      },
      controller.signal,
    );
    if (result._tag === "Failed") {
      error.value = result.message;
    } else {
      other.value = false;
      await reload();
    }
  } catch {
    // Cancelled: back to where the page was.
  } finally {
    pairing.value = null;
  }
};

const toggleOther = async () => {
  other.value = !other.value;
  byHand.value = false;
  tokenError.value = null;
  if (!other.value) return;
  address.value = "";
  apiBaseUrl.value = webOrigin.value === "" ? "" : `${webOrigin.value}/api`;
  await nextTick();
  addressField.value?.focus();
};

const saveToken = async () => {
  saving.value = true;
  tokenError.value = null;
  try {
    const result = await props.actions.saveToken({
      apiBaseUrl: apiBaseUrl.value,
      deviceToken: deviceToken.value,
    });
    if (result._tag === "Failed") {
      tokenError.value = result.message;
      return;
    }
    deviceToken.value = "";
    other.value = false;
    error.value = null;
    await reload();
  } finally {
    saving.value = false;
  }
};

const syncTabs = async () => {
  syncing.value = true;
  syncError.value = null;
  try {
    const result = await props.actions.syncTabs();
    if (result._tag === "Failed") syncError.value = result.message;
    await reload();
  } finally {
    syncing.value = false;
  }
};

const askToDisconnect = async () => {
  confirming.value = true;
  await nextTick();
  keep.value?.focus();
};
const disconnect = async () => {
  await props.actions.disconnect();
  confirming.value = false;
  syncError.value = null;
  await reload();
};

const ago = (at: number) => {
  const age = PopupLink.age(at, now.value);
  return age === "now" ? "just now" : `${age} ago`;
};
const tabCount = (count: number) => (count === 1 ? "1 tab" : `${count} tabs`);
</script>

<template>
  <main class="page">
    <h1 class="brand">
      <img :src="markUrl" alt="" width="32" height="32" />
      <span>stash</span>
    </h1>

    <section class="card" aria-live="polite">
      <p v-if="view === null" class="muted">Checking the connection…</p>

      <template v-else-if="pairing">
        <h2>Approve this browser in Stash</h2>
        <p class="muted">
          A Stash tab just opened. Approve the request there, and this page finishes by itself.
        </p>
        <div v-if="pairing.check" class="check tactile-sunken">
          <span class="muted">Both pages show this code</span>
          <strong class="code">{{ pairing.check }}</strong>
        </div>
        <div class="actions">
          <span class="waiting" role="status">
            <span class="pulse" aria-hidden="true" />
            Waiting for approval…
          </span>
          <button class="button tactile-raised" type="button" name="cancel" @click="pairing.cancel">
            Cancel
          </button>
        </div>
      </template>

      <template v-else-if="view._tag === 'Paired'">
        <div class="headline">
          <h2>Connected to Stash</h2>
          <span class="status"><span class="dot ok" aria-hidden="true" />Connected</span>
        </div>
        <dl class="facts">
          <div class="fact">
            <dt>Stash</dt>
            <dd>{{ host }}</dd>
          </div>
          <div class="fact">
            <dt>This browser</dt>
            <dd>{{ view.deviceName ?? "A device token entered by hand" }}</dd>
          </div>
          <div class="fact">
            <dt>Last save</dt>
            <dd v-if="view.lastSave">
              <span class="clip">{{ view.lastSave.title }}</span>
              <span class="muted">{{ ago(view.lastSave.at) }}</span>
            </dd>
            <dd v-else class="muted">Nothing saved from this browser yet</dd>
          </div>
          <div class="fact">
            <dt>Open tabs</dt>
            <dd v-if="view.tabSync">
              <span>{{ tabCount(view.tabSync.tabs) }} in sync</span>
              <span class="muted">{{ ago(view.tabSync.at) }}</span>
            </dd>
            <dd v-else class="muted">Not synced yet</dd>
          </div>
        </dl>
        <p v-if="syncError" class="alert" role="alert">{{ syncError }}</p>
        <div v-if="confirming" class="actions" role="group" aria-labelledby="ask">
          <span id="ask" class="ask">Disconnect this browser?</span>
          <span class="buttons">
            <button
              ref="keep"
              class="button tactile-raised"
              type="button"
              @click="confirming = false"
            >
              Keep
            </button>
            <button
              class="button tactile-raised danger"
              type="button"
              name="confirm-disconnect"
              @click="disconnect"
            >
              Disconnect
            </button>
          </span>
        </div>
        <div v-else class="actions">
          <span class="buttons">
            <button
              class="button tactile-primary"
              type="button"
              name="open-stash"
              @click="props.actions.openStash(view.webOrigin)"
            >
              Open Stash
            </button>
            <button
              class="button tactile-raised"
              type="button"
              name="sync"
              :disabled="syncing"
              @click="syncTabs"
            >
              {{ syncing ? "Syncing…" : "Sync tabs now" }}
            </button>
          </span>
          <button
            class="button tactile-raised danger"
            type="button"
            name="disconnect"
            @click="askToDisconnect"
          >
            Disconnect
          </button>
        </div>
      </template>

      <template v-else-if="view._tag === 'Unreachable'">
        <div class="headline">
          <h2>Can't reach Stash</h2>
          <span class="status"><span class="dot warn" aria-hidden="true" />Offline</span>
        </div>
        <p class="muted" role="alert">
          This browser is connected to <strong>{{ host }}</strong
          >, but Stash did not answer. Check your connection. Pages you save with the hotkey are
          kept and sent later.
        </p>
        <div v-if="confirming" class="actions" role="group" aria-labelledby="ask">
          <span id="ask" class="ask">Disconnect this browser?</span>
          <span class="buttons">
            <button
              ref="keep"
              class="button tactile-raised"
              type="button"
              @click="confirming = false"
            >
              Keep
            </button>
            <button
              class="button tactile-raised danger"
              type="button"
              name="confirm-disconnect"
              @click="disconnect"
            >
              Disconnect
            </button>
          </span>
        </div>
        <div v-else class="actions">
          <span class="buttons">
            <button class="button tactile-primary" type="button" name="retry" @click="reload">
              Try again
            </button>
            <button
              class="button tactile-raised"
              type="button"
              name="open-stash"
              @click="props.actions.openStash(view.webOrigin)"
            >
              Open Stash
            </button>
          </span>
          <button
            class="button tactile-raised danger"
            type="button"
            name="disconnect"
            @click="askToDisconnect"
          >
            Disconnect
          </button>
        </div>
      </template>

      <template v-else>
        <h2>Connect this browser</h2>
        <p v-if="needsAddress" class="muted">
          Save pages with one key and keep your open tabs in Stash. Enter the address of your Stash
          below to connect.
        </p>
        <template v-else>
          <p class="muted">
            Save pages with one key and keep your open tabs in Stash at <strong>{{ host }}</strong
            >. Stash opens in a tab and asks you to approve this browser. There is nothing to copy.
          </p>
          <button
            class="button tactile-primary wide"
            type="button"
            name="connect"
            @click="connect(view.webOrigin)"
          >
            Connect to Stash
          </button>
        </template>
        <p v-if="error" class="alert" role="alert">{{ error }}</p>
      </template>
    </section>

    <section v-if="showOther" class="card" aria-labelledby="other-title">
      <h2 id="other-title">{{ needsAddress ? "Your Stash" : "A different Stash" }}</h2>
      <form class="form" @submit.prevent="connect(address)">
        <label class="label" for="address">Stash address</label>
        <div class="inline">
          <input
            id="address"
            ref="addressField"
            v-model="address"
            class="field tactile-sunken"
            type="text"
            inputmode="url"
            required
            placeholder="https://stash.example.com"
            autocomplete="url"
            spellcheck="false"
          />
          <button class="button tactile-raised" type="submit" name="connect-address">
            Connect
          </button>
        </div>
      </form>

      <button v-if="!byHand" class="link" type="button" name="by-hand" @click="byHand = true">
        Enter a device token by hand
      </button>
      <form v-else class="form" @submit.prevent="saveToken">
        <span class="rule" aria-hidden="true" />
        <label class="label" for="api-url">API URL</label>
        <input
          id="api-url"
          v-model="apiBaseUrl"
          class="field tactile-sunken"
          type="url"
          required
          placeholder="https://stash.example.com/api"
          autocomplete="url"
          spellcheck="false"
        />
        <label class="label" for="token">Device token</label>
        <input
          id="token"
          v-model="deviceToken"
          class="field tactile-sunken"
          type="password"
          required
          autocomplete="off"
        />
        <p v-if="tokenError" class="alert" role="alert">{{ tokenError }}</p>
        <button class="button tactile-raised end" type="submit" :disabled="saving">
          {{ saving ? "Checking…" : "Save token" }}
        </button>
      </form>
    </section>

    <p v-if="view !== null && !pairing && !needsAddress" class="foot">
      <button class="link" type="button" name="other" :aria-expanded="other" @click="toggleOther">
        {{ other ? "Never mind" : "Use a different Stash" }}
      </button>
    </p>
  </main>
</template>

<!-- The shared tokens and tactile classes, for the whole page. -->
<style src="../../assets/tokens.css"></style>

<style scoped>
.page {
  display: flex;
  width: 100%;
  max-width: 512px;
  flex-direction: column;
  gap: 16px;
  margin: 0 auto;
  padding: 72px 16px 48px;
}

/* The logo: the Well mark and the wordmark (Geist 600, -0.05em). */
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 0 8px;
  padding-inline: 4px;
  font-size: 24px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: -0.05em;
}
.brand img {
  display: block;
}

.card {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 24px;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-surface);
  background: var(--surface);
}
h2 {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  line-height: 24px;
  letter-spacing: -0.01em;
}
p {
  margin: 0;
}
.muted {
  color: var(--muted-foreground);
}
.muted strong {
  color: var(--foreground);
  font-weight: 500;
}

.headline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.status {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 6px;
  color: var(--muted-foreground);
  font-size: 13px;
}
.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}
.dot.ok {
  background: #2e9e5b;
}
.dot.warn {
  background: var(--signal);
}

/* Label on the left, value on the right, a hairline between the rows. */
.facts {
  display: flex;
  flex-direction: column;
  margin: 0;
}
.fact {
  display: flex;
  min-height: 44px;
  align-items: center;
  gap: 16px;
  border-top: 1px solid var(--hairline-row);
}
.fact:last-child {
  border-bottom: 1px solid var(--hairline-row);
}
dt {
  width: 104px;
  flex-shrink: 0;
  color: var(--muted-foreground);
}
dd {
  display: flex;
  min-width: 0;
  flex: 1;
  justify-content: flex-end;
  gap: 8px;
  margin: 0;
  text-align: right;
}
dd > * {
  flex-shrink: 0;
}
dd > .clip {
  min-width: 0;
  flex-shrink: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.check {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-radius: var(--radius-control);
}
.code {
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  font-size: 20px;
  font-weight: 600;
  letter-spacing: 0.16em;
}
.waiting {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--muted-foreground);
}
.pulse {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--signal);
  animation: pulse 1.2s ease-in-out infinite;
}
@keyframes pulse {
  50% {
    opacity: 0.3;
  }
}
@media (prefers-reduced-motion: reduce) {
  .pulse {
    animation: none;
  }
}

.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.ask {
  font-weight: 500;
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
  height: 40px;
}
.button.danger {
  color: var(--destructive);
}
.button.end {
  align-self: flex-end;
}

.alert {
  color: var(--destructive);
  font-size: 13px;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.inline {
  display: flex;
  gap: 8px;
}
.label {
  color: var(--muted-foreground);
  font-size: 13px;
}
.form .field + .label {
  margin-top: 4px;
}
.inline .field {
  flex: 1;
}
.field {
  width: 100%;
  min-width: 0;
  height: var(--control-md);
  flex-shrink: 0;
  padding-inline: 12px;
  border-radius: var(--radius-control);
  color: var(--foreground);
  font: inherit;
}
.field::placeholder {
  color: var(--muted-foreground);
  opacity: 1;
}
.rule {
  height: 1px;
  margin-bottom: 4px;
  background: var(--hairline-row);
}

/* A quiet text button, underlined like the links of the web app. */
.link {
  align-self: flex-start;
  padding: 0;
  border: 0;
  background: none;
  color: var(--muted-foreground);
  font: inherit;
  font-size: 13px;
  text-decoration: underline;
  text-decoration-color: var(--link-underline);
  text-underline-offset: 3px;
  cursor: pointer;
}
.link:hover {
  color: var(--foreground);
}
.foot {
  padding-inline: 4px;
}
</style>
