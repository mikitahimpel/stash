import * as TabsGroup from "@stash/contracts-api/tabs";
import * as ApiToken from "@stash/contracts-domain/api-token";
import * as Device from "@stash/contracts-domain/device";
import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import * as SettingsRows from "../src/settings-rows.ts";
import * as Fixtures from "./fixtures.ts";

const devices = Schema.decodeUnknownSync(Schema.Array(Device.Device));
const tokens = Schema.decodeUnknownSync(Schema.Array(ApiToken.ApiTokenInfo));
const reports = Schema.decodeUnknownSync(TabsGroup.AllTabs);

describe("SettingsRows.make", () => {
  it("keeps the device order and names each token's device", () => {
    const rows = SettingsRows.make(
      devices([Fixtures.device("b", "Phone"), Fixtures.device("a", "Laptop")]),
      tokens([Fixtures.token("t1", "a"), Fixtures.token("t2", "gone")]),
      undefined,
    );
    expect(rows.devices.map((row) => row.device.id)).toEqual(["b", "a"]);
    expect(rows.tokens.map((row) => [row.token.id, row.deviceName])).toEqual([
      ["t1", "Laptop"],
      ["t2", undefined],
    ]);
  });

  it("lists active tokens first, newest first", () => {
    const rows = SettingsRows.make(
      devices([Fixtures.device("a")]),
      tokens([
        Fixtures.token("old", "a", { createdAt: "2026-01-01T00:00:00.000Z" }),
        Fixtures.token("revoked", "a", {
          createdAt: "2026-03-01T00:00:00.000Z",
          revokedAt: "2026-03-02T00:00:00.000Z",
        }),
        Fixtures.token("new", "a", { createdAt: "2026-02-01T00:00:00.000Z" }),
      ]),
      undefined,
    );
    expect(rows.tokens.map((row) => row.token.id)).toEqual(["new", "old", "revoked"]);
  });

  it("takes when a device was last seen from its latest tab report", () => {
    const rows = SettingsRows.make(
      devices([Fixtures.device("a"), Fixtures.device("b"), Fixtures.device("c")]),
      [],
      reports(
        Fixtures.reports([
          ["a", "2026-01-05T00:00:00.000Z"],
          ["b", null],
        ]),
      ).devices,
    );
    expect(rows.devices.map((row) => row.lastSeen && DateTime.formatIso(row.lastSeen))).toEqual([
      "2026-01-05T00:00:00.000Z",
      null,
      null,
    ]);
  });

  it("leaves last seen unknown until the reports load", () => {
    const rows = SettingsRows.make(devices([Fixtures.device("a")]), [], undefined);
    expect(rows.devices[0]?.lastSeen).toBeUndefined();
  });
});

describe("SettingsRows.formatDate", () => {
  it("formats as an ISO date in UTC", () => {
    expect(SettingsRows.formatDate(DateTime.makeUnsafe("2026-01-31T23:30:00.000Z"))).toBe(
      "2026-01-31",
    );
  });
});

describe("SettingsRows.formatLastSeen", () => {
  const now = DateTime.makeUnsafe("2026-01-10T12:00:00.000Z");
  it.each([
    [undefined, "—"],
    [null, "never"],
    ["2026-01-10T11:59:30.000Z", "just now"],
    ["2026-01-10T11:48:00.000Z", "12m ago"],
    ["2026-01-10T07:00:00.000Z", "5h ago"],
    ["2026-01-07T12:00:00.000Z", "3d ago"],
  ])("%s → %s", (at, label) => {
    const lastSeen = typeof at === "string" ? DateTime.makeUnsafe(at) : at;
    expect(SettingsRows.formatLastSeen(lastSeen, now)).toBe(label);
  });
});
