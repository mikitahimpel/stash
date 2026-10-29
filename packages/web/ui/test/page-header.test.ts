import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import PageHeader from "../src/page-header/page-header.vue";

describe("PageHeader", () => {
  it("renders the title as the page's h1, without a subtitle until it has one", () => {
    const wrapper = mount(PageHeader, { props: { title: "Open now" } });

    expect(wrapper.find("h1").text()).toBe("Open now");
    expect(wrapper.find("[data-slot=page-header-subtitle]").exists()).toBe(false);
    expect(wrapper.find("[data-slot=page-header-actions]").exists()).toBe(false);
  });

  it("renders the subtitle and actions when given", () => {
    const wrapper = mount(PageHeader, {
      props: { title: "Open now", subtitle: "17 tabs · 3 devices" },
      slots: { actions: "<button>Archive</button>" },
    });

    expect(wrapper.find("[data-slot=page-header-subtitle]").text()).toBe("17 tabs · 3 devices");
    expect(wrapper.find("[data-slot=page-header-actions] button").text()).toBe("Archive");
  });
});
