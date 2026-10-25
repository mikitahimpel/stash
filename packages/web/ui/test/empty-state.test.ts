import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import EmptyState from "../src/empty-state/empty-state.vue";

describe("EmptyState", () => {
  it("renders only the title when nothing else is given", () => {
    const wrapper = mount(EmptyState, { props: { title: "No links yet" } });

    expect(wrapper.text()).toBe("No links yet");
    expect(wrapper.find("p").exists()).toBe(false);
    expect(wrapper.find("[data-slot=empty-state-icon]").exists()).toBe(false);
    expect(wrapper.find("[data-slot=empty-state-action]").exists()).toBe(false);
  });

  it("renders the description, icon and action when provided", () => {
    const wrapper = mount(EmptyState, {
      props: { title: "No links yet", description: "Save a tab to see it here." },
      slots: { icon: "<svg data-test='icon' />", action: "<button>Import</button>" },
    });

    expect(wrapper.find("p").text()).toBe("Save a tab to see it here.");
    expect(wrapper.find("[data-slot=empty-state-icon] [data-test=icon]").exists()).toBe(true);
    expect(wrapper.find("[data-slot=empty-state-action] button").text()).toBe("Import");
  });
});
