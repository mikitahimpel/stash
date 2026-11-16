<script setup lang="ts">
import { onMounted, ref } from "vue";
import * as PairExtension from "./pair-extension.ts";
import type * as SaveConfig from "./save-config.ts";

const props = defineProps<{
  load: () => Promise<string>;
  save: (input: SaveConfig.Input) => Promise<SaveConfig.Result>;
  connect: (webOrigin: string, onCheck: (check: string) => void) => Promise<PairExtension.Result>;
}>();

const webOrigin = ref("");
const connecting = ref(false);
const connected = ref<PairExtension.Result | null>(null);
// The pairing code's check value, which the Stash approve page shows too.
const check = ref<string>();

const apiBaseUrl = ref("");
const deviceToken = ref("");
const saving = ref(false);
const result = ref<SaveConfig.Result | null>(null);

onMounted(async () => {
  apiBaseUrl.value = await props.load();
  webOrigin.value = PairExtension.webOriginOfApi(apiBaseUrl.value);
});

const connect = async () => {
  connecting.value = true;
  connected.value = null;
  check.value = undefined;
  try {
    connected.value = await props.connect(webOrigin.value, (value) => (check.value = value));
  } finally {
    connecting.value = false;
  }
};

const submit = async () => {
  saving.value = true;
  result.value = null;
  try {
    result.value = await props.save({
      apiBaseUrl: apiBaseUrl.value,
      deviceToken: deviceToken.value,
    });
    if (result.value._tag === "Saved") deviceToken.value = "";
  } finally {
    saving.value = false;
  }
};
</script>

<template>
  <main>
    <h1>Stash</h1>
    <form @submit.prevent="connect">
      <label>
        Your Stash address
        <input
          v-model="webOrigin"
          type="text"
          inputmode="url"
          required
          placeholder="https://stash.example.com"
          autocomplete="url"
        />
      </label>
      <button type="submit" :disabled="connecting">
        {{ connecting ? "Waiting for approval…" : "Connect" }}
      </button>
    </form>
    <p v-if="connecting" role="status">
      Approve this browser in the Stash tab that just opened. Keep this page open.
      <template v-if="check">
        Check that it shows the code <strong>{{ check }}</strong
        >.
      </template>
    </p>
    <p v-else-if="connected?._tag === 'Connected'" role="status">
      Connected to {{ connected.webOrigin }}. Save a tab with Alt+Shift+S.
    </p>
    <p v-else-if="connected?._tag === 'Failed'" role="alert">{{ connected.message }}</p>

    <details>
      <summary>Advanced: enter a device token by hand</summary>
      <form @submit.prevent="submit">
        <label>
          API URL
          <input
            v-model="apiBaseUrl"
            type="url"
            required
            placeholder="https://stash.example.com/api"
            autocomplete="url"
          />
        </label>
        <label>
          Device token
          <input v-model="deviceToken" type="password" required autocomplete="off" />
        </label>
        <button type="submit" :disabled="saving">{{ saving ? "Checking…" : "Save" }}</button>
      </form>
      <p v-if="result?._tag === 'Saved'" role="status">
        Connected{{
          result.principal.kind === "device" ? ` as device ${result.principal.deviceId}` : ""
        }}.
      </p>
      <p v-else-if="result?._tag === 'Failed'" role="alert">{{ result.message }}</p>
    </details>
  </main>
</template>

<style scoped>
main {
  max-width: 28rem;
  font-family: system-ui, sans-serif;
  display: grid;
  gap: 1rem;
}
form {
  display: grid;
  gap: 0.75rem;
}
label {
  display: grid;
  gap: 0.25rem;
}
details form {
  margin-top: 0.75rem;
}
</style>
