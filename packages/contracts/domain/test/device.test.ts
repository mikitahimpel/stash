import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import * as Device from "../src/device.ts";

const device = {
  id: "device-1",
  name: "Work laptop",
  kind: "zen",
  createdAt: "2026-01-02T03:04:05.000Z",
};

describe("DeviceKind", () => {
  it("accepts zen, ios and mac-agent only", () => {
    for (const kind of ["zen", "ios", "mac-agent"]) {
      expect(Schema.is(Device.DeviceKind)(kind)).toBe(true);
    }
    expect(Schema.is(Device.DeviceKind)("android")).toBe(false);
  });
});

describe("Device", () => {
  it("round-trips", () => {
    const decoded = Schema.decodeUnknownSync(Device.Device)(device);
    expect(Schema.encodeSync(Device.Device)(decoded)).toEqual(device);
  });

  it.each([
    ["an unknown kind", { kind: "android" }],
    ["an empty name", { name: "" }],
    ["an empty id", { id: "" }],
  ])("rejects %s", (_, patch) => {
    expect(() => Schema.decodeUnknownSync(Device.Device)({ ...device, ...patch })).toThrow();
  });
});
