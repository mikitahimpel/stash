<script setup lang="ts">
import Button from "@stash/web-ui/button";
import { onBeforeUnmount, onMounted, useTemplateRef } from "vue";

const props = defineProps<{ loading: boolean }>();
const emit = defineEmits<{ more: [] }>();

const more = () => {
  if (!props.loading) emit("more");
};

// Loads the next page as soon as the button scrolls into view. The button stays as a fallback
// where `IntersectionObserver` is missing.
const sentinel = useTemplateRef<HTMLElement>("sentinel");
let observer: IntersectionObserver | undefined;
onMounted(() => {
  if (typeof IntersectionObserver === "undefined" || sentinel.value === null) return;
  observer = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) more();
  });
  observer.observe(sentinel.value);
});
onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <div ref="sentinel" class="flex">
    <Button as-child>
      <button type="button" :disabled="loading" data-action="load-more" @click="more">
        {{ loading ? "Loading…" : "Load more" }}
      </button>
    </Button>
  </div>
</template>
