import * as ApiToken from "@stash/contracts-domain/api-token";
import * as Device from "@stash/contracts-domain/device";
import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import * as DeviceRows from "../src/device-rows.ts";
import * as Fixtures from "./fixtures.ts";

const devices = Schema.decodeUnknownSync(Schema.Array(Device.Device));
const tokens = Schema.decodeUnknownSync(Schema.Array(ApiToken.ApiTokenInfo));

describe("DeviceRows.make", () => {
  it("groups tokens under their device and keeps the device order", () => {
    const rows = DeviceRows.make(
      devices([Fixtures.device("b"), Fixtures.device("a"), Fixtures.device("c")]),
      tokens([Fixtures.token("t1", "a"), Fixtures.token("t2", "b"), Fixtures.token("t3", "a")]),
    );
    expect(rows.map((row) => [row.device.id, row.tokens.map((token) => token.id)])).toEqual([
      ["b", ["t2"]],
      ["a", ["t1", "t3"]],
      ["c", []],
    ]);
  });

  it("lists active tokens first, newest first", () => {
    const [row] = DeviceRows.make(
      devices([Fixtures.device("a")]),
      tokens([
        Fixtures.token("old", "a", { createdAt: "2026-01-01T00:00:00.000Z" }),
        Fixtures.token("revoked", "a", {
          createdAt: "2026-03-01T00:00:00.000Z",
          revokedAt: "2026-03-02T00:00:00.000Z",
        }),
        Fixtures.token("new", "a", { createdAt: "2026-02-01T00:00:00.000Z" }),
      ]),
    );
    expect(row?.tokens.map((token) => token.id)).toEqual(["new", "old", "revoked"]);
  });
});

describe("DeviceRows.formatDate", () => {
  it("formats as an ISO date in UTC", () => {
    expect(DeviceRows.formatDate(DateTime.makeUnsafe("2026-01-31T23:30:00.000Z"))).toBe(
      "2026-01-31",
    );
  });
});
