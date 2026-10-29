<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import Button from "../button/button.vue";
import EmptyState from "../empty-state/empty-state.vue";

const props = withDefaults(
  defineProps<{
    title: string;
    description?: string;
    /** The label of the retry button. */
    retryLabel?: string;
    class?: HTMLAttributes["class"];
  }>(),
  { description: "Check the connection and try again.", retryLabel: "Retry" },
);

// The one error state of the app: an empty state that says what failed, with a raised Retry key.
// Pages show it when a load fails and nothing is cached.
const emit = defineEmits<{ retry: [] }>();
</script>

<template>
  <EmptyState
    data-state="error"
    v-bind="{ role: 'alert' }"
    :title="props.title"
    :description="props.description"
    :class="props.class"
  >
    <template #action>
      <Button as-child variant="raised">
        <button type="button" data-action="retry" @click="emit('retry')">
          {{ props.retryLabel }}
        </button>
      </Button>
    </template>
  </EmptyState>
</template>
