import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import Input from "../src/input/input.vue";

describe("Input", () => {
  it("supports v-model", async () => {
    const wrapper = mount(Input, {
      props: {
        modelValue: "economics",
        "onUpdate:modelValue": (value: string | number | undefined) =>
          wrapper.setProps({ modelValue: value ?? "" }),
      },
    });
    const input = wrapper.find("input");
    expect(input.element.value).toBe("economics");

    await input.setValue("economics video");

    expect(wrapper.props("modelValue")).toBe("economics video");
  });

  it("puts the box on the wrapper and the attributes on the input", () => {
    const wrapper = mount(Input, {
      props: { size: "lg", class: "max-w-80" },
      attrs: { placeholder: "Work laptop", "aria-label": "Name" },
    });

    expect(wrapper.attributes("data-slot")).toBe("input");
    expect(wrapper.classes()).toEqual(
      expect.arrayContaining(["h-control-lg", "tactile-sunken", "rounded-control", "max-w-80"]),
    );
    expect(wrapper.find("input").attributes("aria-label")).toBe("Name");
    expect(wrapper.attributes("aria-label")).toBeUndefined();
  });

  it("focuses the input when its hit area around it is tapped", async () => {
    const probe = mount(Input);
    const body = probe.element.ownerDocument.body;
    probe.unmount();
    const wrapper = mount(Input, { attachTo: body });
    await wrapper.trigger("pointerdown");
    expect(body.ownerDocument.activeElement).toBe(wrapper.find("input").element);
    wrapper.unmount();
  });
});
