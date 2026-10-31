import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { defineComponent, ref } from "vue";
import ToggleChip from "../src/toggle-chip/toggle-chip.vue";

const mountChip = (initial: boolean) =>
  mount(
    defineComponent({
      components: { ToggleChip },
      setup: () => ({ on: ref(initial) }),
      template: `<ToggleChip v-model:pressed="on">Video</ToggleChip>`,
    }),
  );

describe("ToggleChip", () => {
  it("sets aria-pressed from its state", () => {
    expect(mountChip(false).find("button").attributes("aria-pressed")).toBe("false");
    expect(mountChip(true).find("button").attributes("aria-pressed")).toBe("true");
  });

  it("flips aria-pressed and the model on click, and looks pressed while on", async () => {
    const wrapper = mountChip(false);
    const chip = wrapper.find("button");
    expect(chip.classes()).not.toContain("tactile-raised");

    await chip.trigger("click");
    expect(wrapper.vm.on).toBe(true);
    expect(chip.attributes("aria-pressed")).toBe("true");
    expect(chip.classes()).toContain("bg-hairline");
    expect(chip.classes()).not.toContain("tactile-pressed");

    await chip.trigger("click");
    expect(wrapper.vm.on).toBe(false);
    expect(chip.attributes("aria-pressed")).toBe("false");
  });
});
