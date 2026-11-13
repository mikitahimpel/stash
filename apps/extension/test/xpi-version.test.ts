import { describe, expect, it } from "@effect/vitest";
import * as XpiVersion from "../scripts/xpi-version.ts";

describe("package-xpi: signed version", () => {
  it("dates the version and never writes a leading zero", () => {
    expect(XpiVersion.signedVersion(new Date("2026-01-02T00:00:00Z"))).toBe("1.20260102.0");
    expect(XpiVersion.signedVersion(new Date("2026-11-13T09:05:59Z"))).toBe("1.20261113.545");
  });

  it("sorts later signings after earlier ones", () => {
    const parts = (version: string) => version.split(".").map(Number);
    const a = parts(XpiVersion.signedVersion(new Date("2026-11-13T23:59:00Z")));
    const b = parts(XpiVersion.signedVersion(new Date("2026-11-14T00:00:00Z")));
    expect(a[1]! < b[1]!).toBe(true);
  });

  it("replaces only the manifest version", () => {
    const manifest = JSON.stringify({ name: "Stash", version: "0.0.0", manifest_version: 2 });
    expect(JSON.parse(XpiVersion.withVersion(manifest, "1.20260102.0"))).toEqual({
      name: "Stash",
      version: "1.20260102.0",
      manifest_version: 2,
    });
  });
});
