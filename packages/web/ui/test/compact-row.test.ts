import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CheckToggle from "../src/check-toggle/check-toggle.vue";
import CompactRow from "../src/compact-row/compact-row.vue";
import CompactRowLabel from "../src/compact-row/compact-row-label.vue";
import CompactRowSkeleton from "../src/compact-row/compact-row-skeleton.vue";
import CompactRowThumb from "../src/compact-row/compact-row-thumb.vue";
import GroupHeader from "../src/group-header/group-header.vue";
import SiteIcon from "../src/site-icon/site-icon.vue";

const slots = {
  leading: "<i />",
  title: "<a href='https://example.com/'>Example</a>",
  meta: "<span>example.com</span><span>open 3 d</span>",
  trailing: "<span>Saved</span>",
  actions: "<button>Save</button>",
};
const actions = (wrapper: ReturnType<typeof mount>) =>
  wrapper.find("[data-slot=compact-row-actions]");
const touch = (clientX: number, clientY = 100) => ({ pointerType: "touch", clientX, clientY });

describe("CompactRow", () => {
  it("fades out in its place while leaving, in the same height and taking no input", () => {
    const wrapper = mount(CompactRow, { props: { leaving: true }, slots });
    expect(wrapper.attributes("data-leaving")).toBe("");
    expect(wrapper.classes()).toEqual(
      expect.arrayContaining(["h-12", "opacity-0", "transition-opacity", "pointer-events-none"]),
    );
  });

  it("labels a part of a list with its name and count", () => {
    const wrapper = mount(CompactRowLabel, { props: { title: "Window 2", count: "4 tabs" } });
    expect(wrapper.attributes("data-slot")).toBe("compact-row-label");
    expect(wrapper.text()).toBe("Window 24 tabs");
    expect(wrapper.classes()).toContain("h-7");
  });

  it("is one 48px row whatever it holds, with its actions hidden until asked for", () => {
    const wrapper = mount(CompactRow, { slots });
    expect(wrapper.classes()).toContain("h-12");
    expect(wrapper.attributes("data-compact-row")).toBe("");
    expect(wrapper.find("[data-slot=compact-row-meta]").text()).toBe("example.comopen 3 d");
    expect(actions(wrapper).classes()).toContain("hidden");
    // Under the pointer and with keyboard focus they show by CSS alone.
    expect(actions(wrapper).classes()).toContain("group-hover/row:flex");
    expect(actions(wrapper).classes()).toContain("group-has-[:focus-visible]/row:flex");
  });

  it("shows its actions while selected or revealed, in the same height", async () => {
    const wrapper = mount(CompactRow, { props: { selected: true }, slots });
    expect(wrapper.attributes("data-state")).toBe("selected");
    expect(wrapper.classes()).toContain("h-12");
    expect(actions(wrapper).classes()).toContain("flex");
    expect(actions(wrapper).classes()).not.toContain("hidden");

    await wrapper.setProps({ selected: false, revealed: true });
    expect(wrapper.attributes("data-revealed")).toBe("");
    expect(actions(wrapper).classes()).toContain("flex");
    // On a phone they take the place of what stands at the row's end.
    expect(wrapper.find("[data-slot=compact-row-trailing]").classes()).toContain("max-sm:hidden");
  });

  it("asks to reveal on a swipe to the left and to hide on one to the right", async () => {
    const wrapper = mount(CompactRow, { slots });
    await wrapper.trigger("pointerdown", touch(300));
    await wrapper.trigger("pointermove", touch(280));
    expect(wrapper.emitted("update:revealed")).toBeUndefined();
    await wrapper.trigger("pointermove", touch(255, 105));
    expect(wrapper.emitted("update:revealed")).toEqual([[true]]);
    // One swipe, one answer.
    await wrapper.trigger("pointermove", touch(200));
    expect(wrapper.emitted("update:revealed")).toHaveLength(1);

    await wrapper.trigger("pointerdown", touch(200));
    await wrapper.trigger("pointermove", touch(250));
    expect(wrapper.emitted("update:revealed")).toEqual([[true], [false]]);
  });

  it("takes neither a scroll nor a mouse drag for a swipe", async () => {
    const wrapper = mount(CompactRow, { slots });
    await wrapper.trigger("pointerdown", touch(300, 100));
    await wrapper.trigger("pointermove", touch(250, 180));
    await wrapper.trigger("pointerdown", { pointerType: "mouse", clientX: 300, clientY: 100 });
    await wrapper.trigger("pointermove", { pointerType: "mouse", clientX: 200, clientY: 100 });
    expect(wrapper.emitted("update:revealed")).toBeUndefined();
  });

  describe("a held finger", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("emits hold after half a second, and the click that follows is not a click", async () => {
      const clicked = vi.fn();
      const wrapper = mount(CompactRow, { slots, attrs: { onClick: clicked } });
      await wrapper.trigger("pointerdown", touch(100));
      vi.advanceTimersByTime(499);
      expect(wrapper.emitted("hold")).toBeUndefined();
      vi.advanceTimersByTime(1);
      expect(wrapper.emitted("hold")).toHaveLength(1);
      await wrapper.find("a").trigger("click");
      expect(clicked).not.toHaveBeenCalled();
      await wrapper.find("a").trigger("click");
      expect(clicked).toHaveBeenCalledTimes(1);
    });

    it("is not a hold once the finger moves or lifts", async () => {
      const wrapper = mount(CompactRow, { slots });
      await wrapper.trigger("pointerdown", touch(100));
      await wrapper.trigger("pointermove", touch(100, 130));
      vi.advanceTimersByTime(600);
      await wrapper.trigger("pointerdown", touch(100));
      await wrapper.trigger("pointerup", touch(100));
      vi.advanceTimersByTime(600);
      expect(wrapper.emitted("hold")).toBeUndefined();
    });
  });

  it("has a skeleton that is the real row", () => {
    const wrapper = mount(CompactRowSkeleton, { props: { as: "li" } });
    expect(wrapper.element.tagName).toBe("LI");
    expect(wrapper.classes()).toContain("h-12");
    expect(wrapper.attributes("aria-hidden")).toBe("true");
    expect(wrapper.find("[data-shape=icon]").exists()).toBe(true);
  });
});

describe("CompactRowThumb", () => {
  it("draws the picture without a referrer and goes when it fails to load", async () => {
    const wrapper = mount(CompactRowThumb, {
      props: { src: "https://example.com/previews/a.svg" },
    });
    const img = wrapper.find("img");
    expect(img.attributes("referrerpolicy")).toBe("no-referrer");
    await img.trigger("error");
    expect(wrapper.find("[data-slot=compact-row-thumb]").exists()).toBe(false);
  });
});

describe("SiteIcon", () => {
  it("is the site's favicon, and its initial when there is none", async () => {
    const wrapper = mount(SiteIcon, { props: { url: "https://www.example.org/a/b" } });
    expect(wrapper.find("img").attributes()).toMatchObject({
      src: "https://www.example.org/favicon.ico",
      loading: "lazy",
      referrerpolicy: "no-referrer",
      alt: "",
    });
    await wrapper.find("img").trigger("error");
    expect(wrapper.find("img").exists()).toBe(false);
    expect(wrapper.find("[data-initial]").text()).toBe("e");
    expect(wrapper.find("[data-initial]").classes()).toContain("media-cover");

    // Another site gets another try.
    await wrapper.setProps({ url: "https://example.com/" });
    expect(wrapper.find("img").attributes("src")).toBe("https://example.com/favicon.ico");
  });

  it("shows a neutral mark for something that is not a web page", () => {
    const wrapper = mount(SiteIcon, { props: { url: "about:blank" } });
    expect(wrapper.find("img").exists()).toBe(false);
    expect(wrapper.find("[data-initial]").text()).toBe("?");
  });
});

describe("CheckToggle", () => {
  it("is a named checkbox that toggles without clicking what it sits in", async () => {
    const outer = vi.fn();
    const wrapper = mount(CheckToggle, {
      props: { label: "Select Example", checked: false },
      attrs: { onClick: outer },
    });
    expect(wrapper.attributes()).toMatchObject({
      role: "checkbox",
      "aria-checked": "false",
      "aria-label": "Select Example",
    });
    await wrapper.trigger("click");
    expect(wrapper.emitted("update:checked")).toEqual([[true]]);
    await wrapper.setProps({ checked: true });
    expect(wrapper.attributes("aria-checked")).toBe("true");
    expect(wrapper.find("svg").exists()).toBe(true);
  });
});

describe("GroupHeader", () => {
  it("is a plain heading by default", () => {
    const wrapper = mount(GroupHeader, { props: { title: "Today", count: 3 } });
    expect(wrapper.find("h2").text()).toBe("Today3");
    expect(wrapper.find("button").exists()).toBe(false);
    expect(wrapper.attributes("data-sticky")).toBeUndefined();
  });

  it("folds its group from the title when collapsible, and says so", async () => {
    const wrapper = mount(GroupHeader, {
      props: {
        title: "Zen on Work laptop",
        count: "11 tabs",
        meta: "synced just now",
        collapsible: true,
        sticky: true,
      },
    });
    const toggle = wrapper.find("[data-slot=group-header-toggle]");
    expect(toggle.text()).toBe("Zen on Work laptop");
    expect(toggle.attributes("aria-expanded")).toBe("true");
    expect(wrapper.find("[data-slot=group-header-count]").text()).toBe("11 tabs");
    expect(wrapper.find("[data-slot=group-header-meta]").text()).toBe("synced just now");
    expect(wrapper.attributes("data-sticky")).toBe("");
    expect(wrapper.classes()).toContain("sticky");

    await toggle.trigger("click");
    expect(wrapper.emitted("update:open")).toEqual([[false]]);
    await wrapper.setProps({ open: false });
    expect(toggle.attributes("aria-expanded")).toBe("false");
  });

  it("keeps the header's height while it is a placeholder", () => {
    const wrapper = mount(GroupHeader, { props: { placeholder: true, collapsible: true } });
    expect(wrapper.classes()).toContain("min-h-control-sm");
    expect(wrapper.find("button").exists()).toBe(false);
  });
});
