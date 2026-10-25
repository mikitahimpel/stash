<script setup lang="ts">
import type * as SaveAllAndClose from "@stash/ext-capture/save-all-and-close";
import { computed, onMounted, ref } from "vue";

const props = defineProps<{
  load: () => Promise<SaveAllAndClose.Plan | null>;
  confirm: () => Promise<SaveAllAndClose.Outcome | null>;
  close: () => Promise<void>;
}>();

const plan = ref<SaveAllAndClose.Plan | null>(null);
const loaded = ref(false);
const running = ref(false);
const outcome = ref<SaveAllAndClose.Outcome | null>(null);

onMounted(async () => {
  plan.value = await props.load();
  loaded.value = true;
});

const problems: Record<SaveAllAndClose.Problem, string> = {
  RateLimited: "Stash is rate limiting saves. Try again in a minute.",
  Offline: "Stash is unreachable. Try again later.",
  NeedsSetup: "Set the API URL and device token in the Stash settings first.",
  Rejected: "Stash rejected some links.",
  CloseFailed: "The links are saved, but the tabs could not be closed.",
};

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

const summary = computed(() => {
  const result = outcome.value;
  if (result === null) return "";
  const parts = [`Saved and closed ${plural(result.closed, "tab")}.`];
  if (result.kept > 0) parts.push(`${plural(result.kept, "tab")} not saved, left open.`);
  if (result.problem !== null) parts.push(problems[result.problem]);
  return parts.join(" ");
});

const submit = async () => {
  running.value = true;
  try {
    outcome.value = await props.confirm();
    if (outcome.value !== null && outcome.value.kept === 0 && outcome.value.problem === null)
      await props.close();
  } finally {
    running.value = false;
  }
};
</script>

<template>
  <main>
    <h1>Save all &amp; close</h1>
    <p v-if="!loaded">Loading…</p>
    <template v-else-if="outcome !== null">
      <p role="status">{{ summary }}</p>
      <button type="button" @click="close">Close</button>
    </template>
    <template v-else-if="plan === null || plan.entries.length === 0">
      <p>There are no tabs to save here.</p>
      <button type="button" @click="close">Close</button>
    </template>
    <template v-else>
      <p>
        Save {{ plural(plan.entries.length, "tab") }} to Stash and close them?
        <template v-if="plan.skipped.length > 0">
          {{ plural(plan.skipped.length, "pinned or internal tab") }} stay open.
        </template>
      </p>
      <ul>
        <li v-for="entry in plan.entries" :key="entry.tab.id">
          {{ entry.input.title ?? entry.input.url }}
        </li>
      </ul>
      <div class="actions">
        <button type="button" :disabled="running" @click="close">Cancel</button>
        <button type="button" :disabled="running" @click="submit">
          {{ running ? "Saving…" : "Save & close" }}
        </button>
      </div>
    </template>
  </main>
</template>

<style scoped>
main {
  font-family: system-ui, sans-serif;
  padding: 0 0.75rem;
}
ul {
  max-height: 9rem;
  overflow-y: auto;
  padding-left: 1.25rem;
  font-size: 0.875rem;
}
li {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}
</style>
