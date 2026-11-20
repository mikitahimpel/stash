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

const opts = (
  hidden: ReadonlyArray<OpenTabsView.Hidden> = [],
  index: OpenTabsView.SavedIndex = new Map(),
  deleted: ReadonlySet<string> = new Set(),
) => ({
  hidden,
  saved: { index, deleted },
  now,
});

describe("age", () => {
  it.each([
    ["2026-01-10T11:59:30.000Z", "open just now", false],
    ["2026-01-10T11:48:00.000Z", "open 12 min", false],
    ["2026-01-10T07:00:00.000Z", "open 5 h", false],
    ["2026-01-07T12:00:00.000Z", "open 3 d", false],
    ["2026-01-03T12:00:00.000Z", "open 7 d", true],
    ["2026-01-10T12:05:00.000Z", "open just now", false],
  ])("labels a tab opened at %s as %s (stale: %s)", (openedAt, label, stale) => {
    expect(OpenTabsView.age(at(openedAt), now)).toMatchObject({ label, stale });
  });

  it("says nothing without openedAt: the sync time is not the tab's", () => {
    expect(OpenTabsView.age(null, now)).toEqual({ label: null, ms: null, stale: false });
  });
});

describe("active", () => {
  it("says when a tab was last the active one, when the device knows", () => {
    expect(OpenTabsView.active(at("2026-01-10T11:59:30.000Z"), now)).toBe("active now");
    expect(OpenTabsView.active(at("2026-01-10T11:48:00.000Z"), now)).toBe("active 12 min ago");
    expect(OpenTabsView.active(at("2026-01-08T12:00:00.000Z"), now)).toBe("active 2 d ago");
    expect(OpenTabsView.active(undefined, now)).toBeNull();
  });
});

describe("synced", () => {
  it("says when a device last reported", () => {
    expect(OpenTabsView.synced(at("2026-01-10T11:59:40.000Z"), now)).toBe("synced just now");
    expect(OpenTabsView.synced(at("2026-01-10T11:55:00.000Z"), now)).toBe("synced 5 min ago");
    expect(OpenTabsView.synced(at("2026-01-08T11:00:00.000Z"), now)).toBe("synced 2 d ago");
    expect(OpenTabsView.synced(null, now)).toBe("never synced");
  });
});

describe("deviceTitle", () => {
  const device = (name: string, kind: Device.DeviceKind) =>
    ({ id: "d", name, kind, createdAt: now }) as unknown as Device.Device;

  it("names the browser and the device, once", () => {
    expect(OpenTabsView.deviceTitle(device("Work laptop", "zen"))).toBe("Zen on Work laptop");
    expect(OpenTabsView.deviceTitle(device("Zen", "zen"))).toBe("Zen");
    expect(OpenTabsView.deviceTitle(device("My zen browser", "zen"))).toBe("My zen browser");
    expect(OpenTabsView.deviceTitle(device("iPhone", "ios"))).toBe("iPhone");
    expect(OpenTabsView.deviceTitle(device("Mac mini", "mac-agent"))).toBe("Mac mini");
  });
});

describe("pageKey and savedIndex", () => {
  it("is the same for two addresses of one page", () => {
    expect(OpenTabsView.pageKey("https://Example.com/a/#top")).toBe(
      OpenTabsView.pageKey("https://example.com/a"),
    );
    expect(OpenTabsView.pageKey("https://example.com/a?x=1")).not.toBe(
      OpenTabsView.pageKey("https://example.com/a"),
    );
    expect(OpenTabsView.pageKey("not a url")).toBe("not a url");
  });

  it("finds a link by its url or its canonical url, the first of two winning", () => {
    const link = (id: string, url: string, canonicalUrl: string | null = null) =>
      ({ id, url, canonicalUrl }) as unknown as Link.Link;
    const index = OpenTabsView.savedIndex([
      link("new", "https://example.com/a?utm=1", "https://example.com/a"),
      link("old", "https://example.com/a"),
    ]);
    expect(index.get(OpenTabsView.pageKey("https://example.com/a/"))?.id).toBe("new");
    expect(index.get(OpenTabsView.pageKey("https://example.com/a?utm=1"))?.id).toBe("new");
    expect(index.get(OpenTabsView.pageKey("https://example.com/b"))).toBeUndefined();
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
    const groups = OpenTabsView.group(all, opts());
    expect(groups.map((group) => group.device.id)).toEqual(["laptop", "phone"]);
    expect(groups[0]?.tabs).toEqual([
      {
        key: "laptop#https://example.com/a#0",
        deviceId: "laptop",
        deviceName: "Device laptop",
        url: "https://example.com/a",
        host: "example.com",
        title: "Example a",
        age: { label: "open 1 h", stale: false, ms: 3_600_000 },
        active: null,
        windowId: null,
        saved: null,
      },
      {
        key: "laptop#https://example.com/b#0",
        deviceId: "laptop",
        deviceName: "Device laptop",
        url: "https://example.com/b",
        host: "example.com",
        title: null,
        age: { label: "open 1 h", stale: false, ms: 3_600_000 },
        active: null,
        windowId: null,
        saved: null,
      },
    ]);
    expect(groups[1]).toMatchObject({ reportedAt: null, tabs: [] });
  });

  it("marks a tab saved as the api says, exactly by url, unless the link was deleted since", () => {
    const withSaved = decode(
      Fixtures.allTabs(
        Fixtures.deviceTabs("laptop", [Fixtures.tab("a"), Fixtures.tab("b")], Fixtures.takenAt, [
          { url: "https://example.com/a", linkId: "link-a", imageUrl: "https://example.com/a.png" },
        ]),
      ),
    );
    const tabs = OpenTabsView.group(withSaved, opts())[0]?.tabs;
    expect(tabs?.map((tab) => tab.saved)).toEqual([
      { id: "link-a", imageUrl: "https://example.com/a.png" },
      null,
    ]);
    const deleted = OpenTabsView.group(withSaved, opts([], new Map(), new Set(["link-a"])));
    expect(deleted[0]?.tabs.map((tab) => tab.saved)).toEqual([null, null]);
  });

  it("keeps row keys when a tab opens before them, and tells two tabs of one page apart", () => {
    const keys = (paths: ReadonlyArray<string>) =>
      OpenTabsView.group(
        decode(
          Fixtures.allTabs(
            Fixtures.deviceTabs(
              "laptop",
              paths.map((p) => Fixtures.tab(p)),
            ),
          ),
        ),
        opts(),
      )[0]?.tabs.map((tab) => tab.key);
    expect(keys(["b"])).toEqual(["laptop#https://example.com/b#0"]);
    expect(keys(["a", "b", "a"])).toEqual([
      "laptop#https://example.com/a#0",
      "laptop#https://example.com/b#0",
      "laptop#https://example.com/a#1",
    ]);
  });

  it("gives a tab the link its page is saved as", () => {
    const link = { id: "link-1", url: "https://example.com/b", canonicalUrl: null };
    const saved = OpenTabsView.savedIndex([link as unknown as Link.Link]);
    const tabs = OpenTabsView.group(all, opts([], saved))[0]?.tabs;
    expect(tabs?.map((tab) => tab.saved?.id ?? null)).toEqual([null, "link-1"]);
  });

  const hide = (deviceId: string, path: string, since: string): OpenTabsView.Hidden => ({
    deviceId: deviceId as Device.DeviceId,
    url: `https://example.com/${path}` as Link.Url,
    since: at(since),
  });

  it("hides tabs until the device reports a newer snapshot", () => {
    const urls = (hidden: ReadonlyArray<OpenTabsView.Hidden>) =>
      OpenTabsView.group(all, opts(hidden))[0]?.tabs.map((tab) => tab.url);
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

describe("search, sections and summary", () => {
  const all = decode(
    Fixtures.allTabs(
      Fixtures.deviceTabs(
        "laptop",
        [
          Fixtures.tab("week", "2026-01-08T12:00:00.000Z"),
          Fixtures.tab("old", "2026-01-01T12:00:00.000Z"),
          Fixtures.tab("older", "2025-12-01T12:00:00.000Z"),
        ],
        "2026-01-10T11:50:00.000Z",
      ),
      Fixtures.deviceTabs("phone", [
        { ...Fixtures.tab("www", "2026-01-10T11:00:00.000Z"), url: "https://www.example.org/x" },
        Fixtures.tab("unknown", null),
      ]),
      Fixtures.deviceTabs("idle", []),
    ),
  );
  const groups = OpenTabsView.group(all, opts());
  const titles = (sections: ReadonlyArray<OpenTabsView.Section>) =>
    sections.map((section) => [section.id, section.tabs.map((tab) => tab.title)]);

  it("groups by device in the browser's order, then the stale tabs of every device, oldest first", () => {
    const sections = OpenTabsView.sections(groups, now);
    expect(titles(sections)).toEqual([
      ["laptop", ["Example week"]],
      ["phone", ["Example www", "Example unknown"]],
      ["stale", ["Example older", "Example old"]],
    ]);
    expect(sections.map(({ kind, title, count, note }) => [kind, title, count, note])).toEqual([
      ["device", "Zen on Device laptop", "1 tab", "synced 10 min ago"],
      ["device", "Zen on Device phone", "2 tabs", "synced just now"],
      ["stale", "Stale", "2 tabs", "open longer than 7 days"],
    ]);
  });

  it("filters by text in the title, url or device name", () => {
    const older = OpenTabsView.search(groups, "  OLDER ");
    expect(older.map((group) => group.tabs.map((tab) => tab.title))).toEqual([
      ["Example older"],
      [],
      [],
    ]);
    expect(OpenTabsView.search(groups, "example.org")[1]?.tabs[0]?.host).toBe("example.org");
    const byDevice = OpenTabsView.search(groups, "device phone");
    expect(byDevice.map((group) => group.tabs.length)).toEqual([0, 2, 0]);
  });

  it("leaves out groups without tabs", () => {
    expect(OpenTabsView.sections(OpenTabsView.search(groups, "zzz"), now)).toEqual([]);
    expect(titles(OpenTabsView.sections(OpenTabsView.search(groups, "older"), now))).toEqual([
      ["stale", ["Example older"]],
    ]);
  });

  it("sums the page up in one line", () => {
    expect(OpenTabsView.summary(groups)).toBe("5 tabs open · 2 older than a week");
    expect(OpenTabsView.summary(OpenTabsView.search(groups, "www"))).toBe("1 tab open");
    expect(OpenTabsView.summary(OpenTabsView.search(groups, "zzz"))).toBe("");
  });
});

describe("windows", () => {
  const all = decode(
    Fixtures.allTabs(
      Fixtures.deviceTabs("laptop", [
        Fixtures.windowTab("a", { id: "1", name: "Work" }, "2026-01-10T11:55:00.000Z"),
        Fixtures.windowTab("b", { id: "2" }),
        Fixtures.windowTab("c", { id: "1", name: "Work" }),
      ]),
      Fixtures.deviceTabs("phone", [Fixtures.tab("x"), Fixtures.tab("y")]),
    ),
  );
  const sections = OpenTabsView.sections(OpenTabsView.group(all, opts()), now);

  it("splits a device with several windows, named by the space or numbered, in the device's order", () => {
    expect(
      sections[0]?.windows.map((part) => [
        part.title,
        part.count,
        part.tabs.map((tab) => tab.title),
      ]),
    ).toEqual([
      ["Work", "2 tabs", ["Example a", "Example c"]],
      ["Window 2", "1 tab", ["Example b"]],
    ]);
    expect(sections[0]?.tabs[0]?.active).toBe("active 5 min ago");
  });

  it("keeps a device with one window or none as one part, without a title", () => {
    expect(sections[1]?.windows.map((part) => [part.title, part.tabs.length])).toEqual([["", 2]]);
  });
});
