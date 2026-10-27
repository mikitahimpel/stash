import { enableAutoUnmount, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { defineComponent, ref } from "vue";
import SegmentedControl from "../src/segmented-control/segmented-control.vue";

enableAutoUnmount(afterEach);

const mountControl = (initial = "light") =>
  mount(
    defineComponent({
      components: { SegmentedControl },
      setup: () => ({
        theme: ref(initial),
        options: [
          { value: "system", label: "System" },
          { value: "light", label: "Light" },
          { value: "dark", label: "Dark" },
        ],
      }),
      template: `<SegmentedControl v-model="theme" :options="options" label="Theme" />`,
    }),
    // Attached, so focus moves for real.
    { attachTo: "body" },
  );

const segments = (wrapper: ReturnType<typeof mountControl>) => wrapper.findAll("[role=radio]");

const focused = (wrapper: ReturnType<typeof mountControl>) =>
  wrapper.element.ownerDocument.activeElement;

const checked = (wrapper: ReturnType<typeof mountControl>) =>
  segments(wrapper)
    .filter((el) => el.attributes("aria-checked") === "true")
    .map((el) => el.text());

describe("SegmentedControl", () => {
  it("is a labelled radio group with one tab stop on the selected segment", () => {
    const wrapper = mountControl();

    expect(wrapper.find("[role=radiogroup]").attributes("aria-label")).toBe("Theme");
    expect(checked(wrapper)).toEqual(["Light"]);
    expect(segments(wrapper).map((el) => el.attributes("tabindex"))).toEqual(["-1", "0", "-1"]);
  });

  it("selects a segment on click", async () => {
    const wrapper = mountControl();

    await segments(wrapper)[2]?.trigger("click");

    expect(wrapper.vm.theme).toBe("dark");
    expect(checked(wrapper)).toEqual(["Dark"]);
  });

  it("moves the selection and focus with the arrow keys, wrapping at the ends", async () => {
    const wrapper = mountControl();

    await segments(wrapper)[1]?.trigger("keydown", { key: "ArrowRight" });
    expect(wrapper.vm.theme).toBe("dark");
    expect(focused(wrapper)).toBe(segments(wrapper)[2]?.element);

    await segments(wrapper)[2]?.trigger("keydown", { key: "ArrowRight" });
    expect(wrapper.vm.theme).toBe("system");

    await segments(wrapper)[0]?.trigger("keydown", { key: "ArrowLeft" });
    expect(wrapper.vm.theme).toBe("dark");

    await segments(wrapper)[2]?.trigger("keydown", { key: "ArrowUp" });
    expect(wrapper.vm.theme).toBe("light");
    expect(checked(wrapper)).toEqual(["Light"]);
    expect(focused(wrapper)).toBe(segments(wrapper)[1]?.element);
  });

  it("jumps to the ends with Home and End and ignores other keys", async () => {
    const wrapper = mountControl();

    await segments(wrapper)[1]?.trigger("keydown", { key: "End" });
    expect(wrapper.vm.theme).toBe("dark");
    await segments(wrapper)[2]?.trigger("keydown", { key: "Home" });
    expect(wrapper.vm.theme).toBe("system");
    await segments(wrapper)[0]?.trigger("keydown", { key: "a" });
    expect(wrapper.vm.theme).toBe("system");
  });

  it("puts the tab stop on the first segment when nothing is selected", () => {
    const wrapper = mountControl("sepia");

    expect(checked(wrapper)).toEqual([]);
    expect(segments(wrapper).map((el) => el.attributes("tabindex"))).toEqual(["0", "-1", "-1"]);
  });
});
