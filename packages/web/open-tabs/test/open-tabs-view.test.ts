import * as TabsGroup from "@stash/contracts-api/tabs";
import type * as Device from "@stash/contracts-domain/device";
import type * as Link from "@stash/contracts-domain/link";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import * as OpenTabsView from "../src/open-tabs-view.ts";
import * as Fixtures from "./fixtures.ts";

const at = (iso: string) => DateTime.makeUnsafe(iso);
const now = at("2026-01-10T12:00:00.000Z");
const decode = Schema.decodeUnknownSync(TabsGroup.AllTabs);

describe("age", () => {
  it.each([
    ["2026-01-10T11:59:30.000Z", "just now", "fresh"],
    ["2026-01-10T11:48:00.000Z", "12m", "fresh"],
    ["2026-01-10T07:00:00.000Z", "5h", "fresh"],
    ["2026-01-07T12:00:00.000Z", "3d", "aging"],
    ["2026-01-03T12:00:00.000Z", "7d", "old"],
    ["2026-01-10T12:05:00.000Z", "just now", "fresh"],
  ])("labels a tab opened at %s as %s (%s)", (openedAt, label, tone) => {
    expect(OpenTabsView.age(at(openedAt), now)).toMatchObject({ label, tone });
  });

  it("is unknown without openedAt", () => {
    expect(OpenTabsView.age(null, now).tone).toBe("unknown");
  });
});

describe("group", () => {
  const all = decode(
    Fixtures.allTabs(
      Fixtures.deviceTabs("laptop", [Fixtures.tab("a"), { ...Fixtures.tab("b"), title: null }]),
      Fixtures.deviceTabs("phone", null),
    ),
  );

  it("groups tabs by device in api order and keeps the reported tab order", () => {
    const groups = OpenTabsView.group(all, [], now);
    expect(groups.map((group) => group.device.id)).toEqual(["laptop", "phone"]);
    expect(groups[0]?.tabs).toEqual([
      {
        key: "laptop#0#https://example.com/a",
        deviceId: "laptop",
        deviceName: "Device laptop",
        url: "https://example.com/a",
        host: "example.com",
        title: "Example a",
        age: { label: "1h", tone: "fresh", ms: 3_600_000 },
      },
      {
        key: "laptop#1#https://example.com/b",
        deviceId: "laptop",
        deviceName: "Device laptop",
        url: "https://example.com/b",
        host: "example.com",
        title: null,
        age: { label: "1h", tone: "fresh", ms: 3_600_000 },
      },
    ]);
    expect(groups[0]?.reportedAge).toEqual({ label: "just now", tone: "fresh", ms: 0 });
    expect(groups[1]).toMatchObject({ reportedAt: null, reportedAge: null, tabs: [] });
  });

  const hide = (deviceId: string, path: string, since: string): OpenTabsView.Hidden => ({
    deviceId: deviceId as Device.DeviceId,
    url: `https://example.com/${path}` as Link.Url,
    since: at(since),
  });

  it("hides tabs until the device reports a newer snapshot", () => {
    const urls = (hidden: ReadonlyArray<OpenTabsView.Hidden>) =>
      OpenTabsView.group(all, hidden, now)[0]?.tabs.map((tab) => tab.url);
    expect(urls([hide("laptop", "a", "2026-01-10T12:01:00.000Z")])).toEqual([
      "https://example.com/b",
    ]);
    // Same instant as the snapshot: the snapshot can't know about the action yet.
    expect(urls([hide("laptop", "a", Fixtures.takenAt)])).toEqual(["https://example.com/b"]);
    expect(urls([hide("laptop", "a", "2026-01-10T11:00:00.000Z")])).toEqual([
      "https://example.com/a",
      "https://example.com/b",
    ]);
    expect(urls([hide("phone", "a", "2026-01-10T12:01:00.000Z")])).toEqual([
      "https://example.com/a",
      "https://example.com/b",
    ]);
  });
});

describe("apply and sections", () => {
  const all = decode(
    Fixtures.allTabs(
      Fixtures.deviceTabs("laptop", [
        Fixtures.tab("week", "2026-01-08T12:00:00.000Z"),
        Fixtures.tab("old", "2026-01-01T12:00:00.000Z"),
        Fixtures.tab("older", "2025-12-01T12:00:00.000Z"),
      ]),
      Fixtures.deviceTabs("phone", [
        { ...Fixtures.tab("www", "2026-01-10T11:00:00.000Z"), url: "https://www.example.org/x" },
        Fixtures.tab("unknown", null),
      ]),
    ),
  );
  const groups = OpenTabsView.group(all, [], now);
  const paths = (sections: ReadonlyArray<OpenTabsView.Section>) =>
    sections.map((section) => [section.id, section.tabs.map((tab) => tab.title)]);

  it("sorts tabs into old, this week and unknown, oldest first", () => {
    expect(paths(OpenTabsView.sections(groups))).toEqual([
      ["old", ["Example older", "Example old"]],
      ["week", ["Example week", "Example www"]],
      ["unknown", ["Example unknown"]],
    ]);
  });

  it("filters by device and by text in the title, url or device name", () => {
    const phone = OpenTabsView.apply(groups, { device: "phone" as Device.DeviceId, query: "" });
    expect(phone.map((group) => group.device.id)).toEqual(["phone"]);
    expect(phone[0]?.tabs[0]?.host).toBe("example.org");
    const older = OpenTabsView.apply(groups, { device: null, query: "  OLDER " });
    expect(older.map((group) => group.tabs.map((tab) => tab.title))).toEqual([
      ["Example older"],
      [],
    ]);
    const byDevice = OpenTabsView.search(groups, "device phone");
    expect(byDevice.map((group) => group.tabs.length)).toEqual([0, 2]);
  });

  it("leaves out empty sections", () => {
    expect(OpenTabsView.sections(OpenTabsView.search(groups, "zzz"))).toEqual([]);
  });
});
