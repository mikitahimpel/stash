<script setup lang="ts">
import * as AtomVue from "@effect/atom-vue";
import Button from "@stash/web-ui/button";
import Input from "@stash/web-ui/input";
import * as Exit from "effect/Exit";
import { ref } from "vue";
import * as LinksAtoms from "../links-atoms.ts";

const registry = AtomVue.injectRegistry();
const save = AtomVue.useAtomSet(() => LinksAtoms.saveLink, { mode: "promiseExit" });

const text = ref("");
const problem = ref<string>();
// A new save would interrupt the running one, so the field takes one at a time.
const saving = ref(false);

// The row shows up at once. It stays until the feed has loaded the link (see `LinksAtoms.pending`).
const submit = async () => {
  if (saving.value || text.value.trim() === "") return;
  const url = LinksAtoms.parseUrl(text.value);
  if (url === undefined) {
    problem.value = "That doesn't look like a link.";
    return;
  }
  problem.value = undefined;
  saving.value = true;
  const entry = LinksAtoms.addPending(registry, url);
  text.value = "";
  const exit = await save(url);
  saving.value = false;
  if (Exit.isSuccess(exit)) return LinksAtoms.markSaved(registry, entry.key);
  LinksAtoms.dropPending(registry, entry.key);
  if (text.value === "") text.value = url;
  problem.value = "Couldn't save that link. Try again.";
};
</script>

<template>
  <form data-slot="save-link" class="flex w-full flex-col gap-2 sm:w-80" @submit.prevent="submit">
    <div class="flex gap-2">
      <Input
        :model-value="text"
        v-bind="{
          type: 'text',
          inputmode: 'url',
          autocomplete: 'off',
          placeholder: 'Save a link',
          'aria-label': 'Save a link',
          'aria-invalid': problem !== undefined || undefined,
        }"
        @update:model-value="(value) => (text = String(value ?? ''))"
      />
      <Button as-child variant="primary">
        <button type="submit" :disabled="saving">Save</button>
      </Button>
    </div>
    <p v-if="problem" role="alert" class="text-[13px] text-destructive">{{ problem }}</p>
  </form>
</template>
