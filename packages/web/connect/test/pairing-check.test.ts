import { describe, expect, it } from "vitest";
import * as PairingCheck from "../src/pair/pairing-check.ts";

describe("pairing check value", () => {
  it("is the code's first four characters, as the extension shows them", () => {
    expect(PairingCheck.checkValue("Ab3x-synthetic-code-0000000000000000000000")).toBe("Ab3x");
  });
});
