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

  it("lets a caller class override a default utility", () => {
    const wrapper = mount(Input, { props: { class: "h-12" } });

    const classes = wrapper.find("input").classes();
    expect(classes).toContain("h-12");
    expect(classes).not.toContain("h-10");
  });
});
