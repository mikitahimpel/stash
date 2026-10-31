import { DOMWrapper, enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import FilterMenu from "../src/filter-menu/filter-menu.vue";

enableAutoUnmount(afterEach);

const options = [
  { value: "video", label: "Video" },
  { value: "repo", label: "Repo" },
];

const mountMenu = (modelValue: string) => {
  const picked: Array<string> = [];
  const wrapper = mount(FilterMenu, {
    attachTo: "body",
    props: {
      label: "Type",
      options,
      modelValue,
      "onUpdate:modelValue": (value: string) => picked.push(value),
    },
  });
  return { wrapper, picked };
};

describe("FilterMenu", () => {
  it("names the filter and its choice on one compact trigger", () => {
    expect(mountMenu("").wrapper.text()).toBe("Type: Any");
    expect(mountMenu("video").wrapper.text()).toBe("Type: Video");
  });

  it("offers Any and every option, and reports the pick", async () => {
    const { wrapper, picked } = mountMenu("video");
    await wrapper.find("[data-slot=filter-menu]").trigger("keydown", { key: "Enter" });
    await flushPromises();
    const items = new DOMWrapper(wrapper.element.ownerDocument.body).findAll(
      "[role=menuitemradio]",
    );
    expect(items.map((item) => item.text())).toEqual(["Any", "Video", "Repo"]);

    await items[2]?.trigger("click");
    expect(picked).toEqual(["repo"]);
  });

  it("clears the filter with Any", async () => {
    const { wrapper, picked } = mountMenu("video");
    await wrapper.find("[data-slot=filter-menu]").trigger("keydown", { key: "Enter" });
    await flushPromises();
    await new DOMWrapper(wrapper.element.ownerDocument.body)
      .find("[role=menuitemradio]")
      .trigger("click");
    expect(picked).toEqual([""]);
  });
});
