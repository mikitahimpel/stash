import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import Button from "../src/button/button.vue";

describe("Button", () => {
  it("renders a button with the variant classes", () => {
    const wrapper = mount(Button, {
      props: { variant: "destructive" },
      slots: { default: "Delete" },
    });

    expect(wrapper.element.tagName).toBe("BUTTON");
    expect(wrapper.classes()).toContain("bg-destructive");
  });

  it("styles its child instead with as-child", () => {
    const wrapper = mount(Button, {
      props: { asChild: true, variant: "link" },
      slots: { default: '<a href="https://example.com/article">Open</a>' },
    });

    expect(wrapper.element.tagName).toBe("A");
    expect(wrapper.attributes("href")).toBe("https://example.com/article");
    expect(wrapper.classes()).toContain("underline-offset-4");
  });
});
