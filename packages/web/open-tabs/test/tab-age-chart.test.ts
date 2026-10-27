import * as TabsGroup from "@stash/contracts-api/tabs";
import { mount } from "@vue/test-utils";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import * as OpenTabsView from "../src/open-tabs-view.ts";
import TabAgeChart from "../src/tab-age-chart.vue";
import * as Fixtures from "./fixtures.ts";

const now = DateTime.makeUnsafe("2026-01-10T12:00:00.000Z");
const groups = OpenTabsView.group(
  Schema.decodeUnknownSync(TabsGroup.AllTabs)(
    Fixtures.allTabs(
      Fixtures.deviceTabs("laptop", [
        Fixtures.tab("nine-days", "2026-01-01T12:00:00.000Z"),
        Fixtures.tab("two-days", "2026-01-08T12:00:00.000Z"),
        Fixtures.tab("a-month", "2025-12-10T12:00:00.000Z"),
      ]),
      Fixtures.deviceTabs("phone", [Fixtures.tab("unknown", null)]),
    ),
  ),
  [],
  now,
);

const percent = (value: string | undefined) => Number.parseFloat(value ?? "");

const ticks = (selected: string | null = null) => {
  const wrapper = mount(TabAgeChart, { props: { groups, selected } });
  return {
    wrapper,
    ticks: wrapper.findAll("[data-slot=lane]").map((lane) => lane.findAll("rect")),
  };
};

describe("tab-age-chart", () => {
  it("draws one lane per device and a tick per tab of known age", () => {
    const chart = ticks();
    expect(chart.ticks.map((lane) => lane.length)).toEqual([3, 0]);
    expect(chart.wrapper.attributes("role")).toBe("img");
    expect(chart.wrapper.attributes("aria-label")).toBe(
      "Tab age: 4 tabs on 2 devices, 2 older than 7 days, 1 of unknown age",
    );
  });

  it("places a 9-day tab past the 7d line and colours it as stale", () => {
    const { wrapper, ticks: lanes } = ticks();
    const [nine, two, month] = lanes[0] ?? [];
    const staleLine = percent(wrapper.find("[data-slot=stale-region]").attributes("x"));
    expect(staleLine).toBeCloseTo(50);
    expect(percent(nine?.attributes("x"))).toBeGreaterThan(staleLine);
    expect(nine?.attributes("data-stale")).toBe("true");
    expect(nine?.classes()).toContain("fill-signal");
    expect(percent(two?.attributes("x"))).toBeLessThan(staleLine);
    expect(two?.attributes("data-stale")).toBe("false");
    expect(two?.classes()).not.toContain("fill-signal");
    // Older than 14 days stays at the end.
    expect(percent(month?.attributes("x"))).toBeGreaterThan(99);
  });

  it("marks the selected tab with a taller tick and a title · age label", () => {
    const key = groups[0]?.tabs[1]?.key ?? "";
    const { wrapper, ticks: lanes } = ticks(key);
    const selected = lanes[0]?.[1];
    expect(selected?.attributes("data-selected")).toBe("true");
    expect(Number(selected?.attributes("height"))).toBeGreaterThan(
      Number(lanes[0]?.[0]?.attributes("height")),
    );
    expect(wrapper.find("[data-slot=tick-label]").text()).toBe("Example two-days · 2d");
  });
});
