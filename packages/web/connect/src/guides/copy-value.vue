<script setup lang="ts">
import { useAtomSet } from "@effect/atom-vue";
import { Check, Copy } from "@lucide/vue";
import Button from "@stash/web-ui/button";
import Input from "@stash/web-ui/input";
import * as Exit from "effect/Exit";
import { ref, watch } from "vue";
import * as ConnectAtoms from "../connect-atoms.ts";

// A prefilled value: read-only, in mono, with a Copy button beside it.
const props = defineProps<{
  /** Names the value for screen readers and tests: `Shortcut URL`, `Install command`. */
  label: string;
  value: string;
}>();

const copy = useAtomSet(() => ConnectAtoms.copy, { mode: "promiseExit" });
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
  <div class="flex min-w-0 flex-col gap-1">
    <div class="flex min-w-0 items-center gap-2" :data-copy="label">
      <Input
        :model-value="value"
        size="sm"
        mono
        class="min-w-0 flex-1"
        v-bind="{ readonly: true, 'aria-label': label, spellcheck: false }"
      />
      <Button as-child variant="secondary" size="sm">
        <button type="button" data-action="copy" :aria-label="`Copy ${label}`" @click="copyValue">
          <Check v-if="state === 'copied'" :size="16" aria-hidden="true" />
          <Copy v-else :size="16" aria-hidden="true" />
          {{ state === "copied" ? "Copied" : "Copy" }}
        </button>
      </Button>
    </div>
    <p v-if="state === 'failed'" role="alert" class="text-meta text-destructive">
      Couldn't copy. Select the text and copy it by hand.
    </p>
  </div>
</template>
