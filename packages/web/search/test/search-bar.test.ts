import { DOMWrapper, enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import SearchBar from "../src/search-bar.vue";
import * as SearchRequest from "../src/search-request.ts";

enableAutoUnmount(afterEach);

const devices = [
  { value: "device-1", label: "Laptop" },
  { value: "device-2", label: "Phone" },
];

const mountBar = (
  form: Partial<SearchRequest.Form>,
  count: number | "pending" = 12,
  options = devices,
) => {
  const changes: Array<SearchRequest.Form> = [];
  const wrapper = mount(SearchBar, {
    attachTo: "body",
    props: {
      form: { ...SearchRequest.emptyForm, q: "rust", ...form },
      count: count === "pending" ? undefined : count,
      waiting: false,
      devices: options,
      onChange: (next: SearchRequest.Form) => changes.push(next),
    },
  });
  return { wrapper, changes };
};

const triggers = (wrapper: ReturnType<typeof mountBar>["wrapper"]) =>
  wrapper.findAll("[data-slot=filter-menu]").map((trigger) => trigger.text());

const pick = async (
  wrapper: ReturnType<typeof mountBar>["wrapper"],
  menu: string,
  option: string,
) => {
  const trigger = wrapper
    .findAll("[data-slot=filter-menu]")
    .find((item) => item.text().startsWith(menu));
  await trigger?.trigger("keydown", { key: "Enter" });
  await flushPromises();
  const items = new DOMWrapper(wrapper.element.ownerDocument.body).findAll("[role=menuitemradio]");
  await items.find((item) => item.text() === option)?.trigger("click");
  await flushPromises();
};

describe("SearchBar", () => {
  it("says how many links match which query", () => {
    const summary = (count: number | "pending", q = "rust") =>
      mountBar({ q }, count).wrapper.find("[data-slot=search-summary]").text();
    expect(summary(12)).toBe("12 results for “rust”");
    expect(summary(1)).toBe("1 result for “rust”");
    expect(summary(0, " rust async ")).toBe("0 results for “rust async”");
    expect(summary("pending")).toBe("Searching for “rust”");
  });

  it("holds the mode and the Type, Device and Date menus on one line", () => {
    const { wrapper } = mountBar({ mode: "keyword", type: "video", range: "week" });
    expect(triggers(wrapper)).toEqual([
      "Keywords",
      "Type: Video",
      "Device: Any",
      "Date: Past week",
    ]);
  });

  it("has no Device menu until there are devices", () => {
    expect(triggers(mountBar({}, 3, []).wrapper)).toEqual(["Hybrid", "Type: Any", "Date: Any"]);
  });

  it("reports a new mode, which is never empty", async () => {
    const { wrapper, changes } = mountBar({});
    await pick(wrapper, "Hybrid", "Meaning");
    expect(changes.map((form) => form.mode)).toEqual(["semantic"]);
    const items = new DOMWrapper(wrapper.element.ownerDocument.body).findAll(
      "[role=menuitemradio]",
    );
    expect(items.map((item) => item.text())).not.toContain("Any");
  });

  it("reports a picked filter with the rest of the form", async () => {
    const { wrapper, changes } = mountBar({ type: "video" });
    await pick(wrapper, "Device", "Phone");
    expect(changes).toEqual([
      { ...SearchRequest.emptyForm, q: "rust", type: "video", device: "device-2" },
    ]);
  });

  it("shows the tag as a chip that clears it", async () => {
    const { wrapper, changes } = mountBar({ tag: "go" });
    const chip = wrapper.find("[data-clear=tag]");
    expect(chip.text()).toContain("#go");
    await chip.trigger("click");
    expect(changes.map((form) => form.tag)).toEqual([""]);
  });

  it("is busy while the next answer is on its way", async () => {
    const { wrapper } = mountBar({});
    expect(wrapper.attributes("aria-busy")).toBeUndefined();
    await wrapper.setProps({ waiting: true });
    expect(wrapper.attributes("aria-busy")).toBe("true");
  });
});
