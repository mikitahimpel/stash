import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ListRow from "../src/list-row/list-row.vue";
import SearchField from "../src/search-field/search-field.vue";
import SectionHeader from "../src/section-header/section-header.vue";

describe("ListRow", () => {
  it("shows the action bar only while selected", async () => {
    const wrapper = mount(ListRow, {
      props: { selected: false },
      slots: { default: "Example article", actions: "<button>Archive</button>" },
    });
    expect(wrapper.find("[data-slot=list-row-actions]").exists()).toBe(false);

    await wrapper.setProps({ selected: true });
    expect(wrapper.attributes("data-state")).toBe("selected");
    expect(wrapper.classes()).toContain("tactile-row-selected");
    expect(wrapper.find("[data-slot=list-row-actions]").text()).toBe("Archive");
  });
});

describe("SectionHeader", () => {
  it("renders the count and actions only when given", () => {
    const bare = mount(SectionHeader, { props: { title: "Inbox" } });
    expect(bare.find("h2").text()).toBe("Inbox");
    expect(bare.find("[data-slot=section-header-count]").exists()).toBe(false);
    expect(bare.find("[data-slot=section-header-actions]").exists()).toBe(false);

    const full = mount(SectionHeader, {
      props: { title: "Inbox", count: 12, as: "h1" },
      slots: { actions: "<button>Mark read</button>" },
    });
    expect(full.find("h1 [data-slot=section-header-count]").text()).toBe("12");
    expect(full.find("[data-slot=section-header-actions]").text()).toBe("Mark read");
  });
});

describe("SearchField", () => {
  it("binds the query and passes attributes to the input", async () => {
    const wrapper = mount(SearchField, {
      props: { modelValue: "", shortcut: "/", placeholder: "Search", "aria-label": "Search links" },
    });
    const input = wrapper.find("input");
    expect(input.attributes("placeholder")).toBe("Search");
    expect(input.attributes("aria-label")).toBe("Search links");
    expect(wrapper.find("kbd").text()).toBe("/");

    await input.setValue("economics");
    expect(wrapper.emitted("update:modelValue")).toEqual([["economics"]]);
  });

  it("leaves out the keycap without a shortcut", () => {
    expect(mount(SearchField).find("kbd").exists()).toBe(false);
  });
});
