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

  it("keeps the older variants working as raised keys", () => {
    for (const variant of ["default", "outline", "secondary"] as const) {
      const wrapper = mount(Button, { props: { variant }, slots: { default: "Go" } });
      expect(wrapper.classes()).toContain("tactile-raised");
    }
  });

  it("styles its child instead with as-child", () => {
    const wrapper = mount(Button, {
      props: { asChild: true, variant: "link" },
      slots: { default: '<a href="https://example.com/article">Open</a>' },
    });

    expect(wrapper.element.tagName).toBe("A");
    expect(wrapper.attributes("href")).toBe("https://example.com/article");
    expect(wrapper.classes()).toContain("link-underline");
  });
});
