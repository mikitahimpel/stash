import { describe, expect, it } from "vitest";
import * as XpiInfo from "../scripts/xpi-info.ts";

describe("xpi info", () => {
  it("sits beside the .xpi", () => {
    expect(XpiInfo.infoPath("/out/downloads/stash-extension.xpi")).toBe(
      "/out/downloads/stash-extension.json",
    );
  });

  it("says whether the file is signed", () => {
    expect(JSON.parse(XpiInfo.infoJson(true))).toEqual({ signed: true });
    expect(JSON.parse(XpiInfo.infoJson(false))).toEqual({ signed: false });
  });
});
