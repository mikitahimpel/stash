import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import * as TagFit from "../src/tag-chip/tag-fit";
import TagLine from "../src/tag-chip/tag-line.vue";

describe("TagFit.count", () => {
  const fit = (line: number, chips: ReadonlyArray<number>, total = chips.length, more?: number) =>
    TagFit.count({ line, chips, more, total, gap: 4 });

  it("shows every chip that fits", () => {
    expect(fit(200, [60, 60, 60])).toBe(3);
    expect(fit(188, [60, 60, 60])).toBe(3);
    expect(fit(187, [60, 60, 60])).toBe(2);
  });

  it("keeps room for +N whenever a tag is left out", () => {
    // Three chips fit alone, but two more tags need the +N chip (30 wide) after them.
    expect(fit(200, [60, 60, 60], 5, 30)).toBe(2);
    expect(fit(222, [60, 60, 60], 5, 30)).toBe(3);
    // The chip that would fit alone gives way to +N.
    expect(fit(130, [60, 60, 60], 3, 30)).toBe(1);
    expect(fit(50, [60, 60], 2, 30)).toBe(0);
  });

  it("shows every candidate where nothing is laid out", () => {
    expect(fit(0, [0, 0, 0], 5)).toBe(3);
  });
});

describe("TagLine", () => {
  it("shows at most `max` tags and the rest as +N, on one line", async () => {
    const line = mount(TagLine, { props: { tags: ["a", "b", "c", "d", "e"] } });
    await line.vm.$nextTick();
    expect(line.findAll("[data-slot=tag-chip]").map((chip) => chip.text())).toEqual([
      "#a",
      "#b",
      "#c",
    ]);
    expect(line.find("[data-slot=more-tags]").text()).toBe("+2");

    await line.setProps({ tags: ["a"], max: 3 });
    await line.vm.$nextTick();
    expect(line.findAll("[data-slot=tag-chip]").map((chip) => chip.text())).toEqual(["#a"]);
    expect(line.find("[data-slot=more-tags]").exists()).toBe(false);
  });

  it("is an empty line without tags, and renders a tag through its slot", () => {
    expect(
      mount(TagLine, { props: { tags: [] } })
        .find("[data-slot=tag-chip]")
        .exists(),
    ).toBe(false);
    const line = mount(TagLine, {
      props: { tags: ["x"] },
      slots: { tag: `<template #tag="{ tag }"><a data-tag>{{ tag }}</a></template>` },
    });
    expect(line.find("a[data-tag]").text()).toBe("x");
  });
});
