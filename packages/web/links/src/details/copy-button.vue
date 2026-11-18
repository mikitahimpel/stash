<script setup lang="ts">
import * as AtomVue from "@effect/atom-vue";
import { Check, Copy } from "@lucide/vue";
import Button from "@stash/web-ui/button";
import * as Exit from "effect/Exit";
import { ref, watch } from "vue";
import * as LinksAtoms from "../links-atoms.ts";

// Copies a value shown beside it (a link's URL), and says so for a moment's glance.
const props = defineProps<{
  /** Names the value for screen readers: `URL`, `Canonical URL`. */
  label: string;
  value: string;
}>();

const copy = AtomVue.useAtomSet(() => LinksAtoms.copy, { mode: "promiseExit" });
const state = ref<"idle" | "copied" | "failed">("idle");
watch(
  () => props.value,
  () => (state.value = "idle"),
);
const copyValue = async () => {
  state.value = Exit.isSuccess(await copy(props.value)) ? "copied" : "failed";
};
</script>

<template>
  <Button as-child variant="ghost" size="icon-sm">
    <button
      type="button"
      data-action="copy"
      :data-state="state"
      :aria-label="
        state === 'copied'
          ? `Copied ${label}`
          : state === 'failed'
            ? `Couldn't copy ${label}`
            : `Copy ${label}`
      "
      :title="state === 'failed' ? 'Couldn\'t copy' : 'Copy'"
      @click="copyValue"
    >
      <Check v-if="state === 'copied'" aria-hidden="true" />
      <Copy v-else aria-hidden="true" />
    </button>
  </Button>
</template>
