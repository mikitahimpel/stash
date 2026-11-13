import { describe, expect, it } from "vitest";
import { cn } from "../src/cn";

describe("cn", () => {
  it("keeps a text role next to a text color", () => {
    expect(cn("text-label text-foreground").split(" ")).toEqual(["text-label", "text-foreground"]);
    expect(cn("text-meta text-body")).toBe("text-body");
  });

  it("lets a later control height or radius replace an earlier one", () => {
    expect(cn("h-control-md h-control-sm")).toBe("h-control-sm");
    expect(cn("rounded-control rounded-full")).toBe("rounded-full");
  });
});
