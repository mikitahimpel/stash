<script setup lang="ts" generic="T extends string">
import { ChevronDown } from "@lucide/vue";
import { computed, type HTMLAttributes } from "vue";
import Button from "../button/button.vue";
import DropdownMenuContent from "../dropdown-menu/dropdown-menu-content.vue";
import DropdownMenuRadioGroup from "../dropdown-menu/dropdown-menu-radio-group.vue";
import DropdownMenuRadioItem from "../dropdown-menu/dropdown-menu-radio-item.vue";
import DropdownMenuTrigger from "../dropdown-menu/dropdown-menu-trigger.vue";
import DropdownMenu from "../dropdown-menu/dropdown-menu.vue";
import type { SegmentedControlOption } from "../segmented-control/segmented-control-option";

const props = defineProps<{
  /** What it filters, as shown on the trigger: `Type: Any`. */
  label: string;
  options: ReadonlyArray<SegmentedControlOption<T>>;
  class?: HTMLAttributes["class"];
}>();
/** The chosen option, `""` for any. */
const model = defineModel<T | "">({ required: true });

const current = computed(
  () => props.options.find((option) => option.value === model.value)?.label ?? "Any",
);
const pick = (value: unknown) => {
  model.value = props.options.find((option) => option.value === value)?.value ?? "";
};
</script>

<template>
  <!-- One compact, quiet control for a choice of filters, instead of a row of chips. -->
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button as-child variant="ghost" size="sm" :class="['px-2 sm:h-8', props.class]">
        <button type="button" data-slot="filter-menu" :data-active="model !== '' || undefined">
          {{ label }}: <span class="text-foreground">{{ current }}</span>
          <ChevronDown aria-hidden="true" class="size-3.5" />
        </button>
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" class="min-w-40">
      <DropdownMenuRadioGroup :model-value="model" @update:model-value="pick">
        <DropdownMenuRadioItem value="">Any</DropdownMenuRadioItem>
        <DropdownMenuRadioItem
          v-for="option in options"
          :key="option.value"
          :value="option.value"
          :data-filter-option="option.value"
        >
          {{ option.label }}
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
