<script setup lang="ts">
import { onMounted, ref } from "vue";
import type * as SaveConfig from "./save-config.ts";

const props = defineProps<{
  load: () => Promise<string>;
  save: (input: SaveConfig.Input) => Promise<SaveConfig.Result>;
}>();

const apiBaseUrl = ref("");
const deviceToken = ref("");
const saving = ref(false);
const result = ref<SaveConfig.Result | null>(null);

onMounted(async () => {
  apiBaseUrl.value = await props.load();
});

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
    <form @submit.prevent="submit">
      <label>
        API URL
        <input
          v-model="apiBaseUrl"
          type="url"
          required
          placeholder="https://stash.example.com"
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
  </main>
</template>

<style scoped>
main {
  max-width: 28rem;
  font-family: system-ui, sans-serif;
}
form {
  display: grid;
  gap: 0.75rem;
}
label {
  display: grid;
  gap: 0.25rem;
}
</style>
