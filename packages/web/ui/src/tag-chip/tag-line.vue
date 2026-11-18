<script setup lang="ts" generic="T extends string">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from "vue";
import * as TagFit from "./tag-fit";
import TagChip from "./tag-chip.vue";

// The tags of a row, on one line that never wraps: as many chips as fit (at most `max`), and the
// rest as a `+N` chip. It measures its chips, so a narrow row (a phone) shows fewer of them
// instead of cutting one in half. With no tags it is an empty line of the same height.
const props = withDefaults(
  defineProps<{
    tags: ReadonlyArray<T>;
    /** How many chips the line shows at most, however wide it is. */
    max?: number;
  }>(),
  { max: 3 },
);

defineSlots<{
  /** One tag, as a `<TagChip>` (a link to the list narrowed to it, say). */
  tag?: (props: { tag: T }) => unknown;
}>();

const line = useTemplateRef<HTMLElement>("line");
const cap = computed(() => Math.min(props.max, props.tags.length));
/** How many chips the line shows; `null` while it shows every candidate to measure them. */
const fit = ref<number | null>(null);
const count = computed(() => fit.value ?? cap.value);
const shown = computed(() => props.tags.slice(0, count.value));
const more = computed(() => props.tags.length - count.value);

const gap = 4;
let pass = 0;
const measure = async () => {
  const mine = ++pass;
  fit.value = null;
  await nextTick();
  const el = line.value;
  if (mine !== pass || el === null) return;
  const chips = [...el.children].filter((child) => child instanceof HTMLElement);
  const moreChip = chips.find((chip) => chip.dataset["slot"] === "more-tags");
  fit.value = TagFit.count({
    line: el.clientWidth,
    chips: chips.filter((chip) => chip !== moreChip).map((chip) => chip.offsetWidth),
    more: moreChip?.offsetWidth,
    total: props.tags.length,
    gap,
  });
};

let observer: ResizeObserver | undefined;
onMounted(() => {
  void measure();
  if (typeof ResizeObserver === "undefined" || line.value === null) return;
  let width = line.value.clientWidth;
  observer = new ResizeObserver(() => {
    const next = line.value?.clientWidth ?? width;
    if (next === width) return;
    width = next;
    void measure();
  });
  observer.observe(line.value);
});
onBeforeUnmount(() => observer?.disconnect());
watch(
  () => [props.tags.join("\n"), props.max],
  () => void measure(),
  { flush: "post" },
);
</script>

<template>
  <div ref="line" data-slot="tag-line" class="flex h-6 min-w-0 items-center gap-1 overflow-hidden">
    <template v-for="tag in shown" :key="tag">
      <slot name="tag" :tag="tag">
        <TagChip>#{{ tag }}</TagChip>
      </slot>
    </template>
    <TagChip v-if="more > 0" data-slot="more-tags">+{{ more }}</TagChip>
  </div>
</template>
