import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import Button from "../src/button/button.vue";

describe("Button", () => {
  it("renders a raised key by default", () => {
    const wrapper = mount(Button, { slots: { default: "Save" } });

    expect(wrapper.element.tagName).toBe("BUTTON");
    expect(wrapper.text()).toBe("Save");
    expect(wrapper.classes()).toContain("tactile-raised");
  });

  it.each([
    ["raised", "tactile-raised"],
    ["primary", "tactile-primary"],
    ["ghost", "hover:bg-accent"],
    ["destructive", "text-destructive"],
  ] as const)("renders the %s variant", (variant, expected) => {
    const wrapper = mount(Button, { props: { variant }, slots: { default: "Go" } });

    expect(wrapper.classes()).toContain(expected);
  });

  it("renders secondary as a raised key", () => {
    const wrapper = mount(Button, { props: { variant: "secondary" }, slots: { default: "Go" } });
    expect(wrapper.classes()).toContain("tactile-raised");
  });

  it.each([
    ["sm", "h-control-sm"],
    ["md", "h-control-md"],
    ["lg", "h-control-lg"],
    ["icon-sm", "size-control-sm"],
    ["icon", "size-control-md"],
    ["icon-lg", "size-control-lg"],
  ] as const)("takes its %s height from the control tokens", (size, expected) => {
    const wrapper = mount(Button, { props: { size }, slots: { default: "Go" } });
    expect(wrapper.classes()).toContain(expected);
    expect(wrapper.classes()).toContain("rounded-control");
    expect(wrapper.classes()).toContain("hit-area");
  });

  it("styles its child instead with as-child", () => {
    const wrapper = mount(Button, {
      props: { asChild: true, variant: "ghost", size: "sm" },
      slots: { default: '<a href="https://example.com/article">Open</a>' },
    });

    expect(wrapper.element.tagName).toBe("A");
    expect(wrapper.attributes("href")).toBe("https://example.com/article");
    expect(wrapper.classes()).toContain("h-control-sm");
  });
});
