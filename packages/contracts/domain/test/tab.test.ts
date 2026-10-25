import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import * as Tab from "../src/tab.ts";

const snapshot = {
  deviceId: "device-1",
  takenAt: "2026-01-02T03:04:05.000Z",
  tabs: [
    {
      url: "https://example.com/one",
      title: "Tab one",
      openedAt: "2026-01-01T00:00:00.000Z",
      lastSeenAt: "2026-01-02T03:04:05.000Z",
    },
    {
      url: "https://example.com/two",
      title: null,
      openedAt: null,
      lastSeenAt: "2026-01-02T03:04:05.000Z",
    },
  ],
};

describe("TabsSnapshot", () => {
  it("round-trips", () => {
    const decoded = Schema.decodeUnknownSync(Tab.TabsSnapshot)(snapshot);
    expect(decoded.tabs).toHaveLength(2);
    expect(Schema.encodeSync(Tab.TabsSnapshot)(decoded)).toEqual(snapshot);
  });

  it("accepts an empty snapshot", () => {
    expect(Schema.decodeUnknownSync(Tab.TabsSnapshot)({ ...snapshot, tabs: [] }).tabs).toEqual([]);
  });

  it("rejects a tab with an invalid url", () => {
    const tabs = [{ ...snapshot.tabs[0], url: "about:blank" }];
    expect(() => Schema.decodeUnknownSync(Tab.TabsSnapshot)({ ...snapshot, tabs })).toThrow();
  });

  it("rejects a snapshot without a device", () => {
    const { deviceId: _, ...rest } = snapshot;
    expect(() => Schema.decodeUnknownSync(Tab.TabsSnapshot)(rest)).toThrow();
  });
});
