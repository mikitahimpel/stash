import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import * as Tag from "../src/tag.ts";

describe("TagName", () => {
  it.each(["economics", "machine learning", "экономика", "c++"])("accepts %j", (name) => {
    expect(Schema.decodeUnknownSync(Tag.TagName)(name)).toBe(name);
  });

  it.each(["", " padded ", "Economics", "x".repeat(65), 1])("rejects %j", (name) => {
    expect(Schema.is(Tag.TagName)(name)).toBe(false);
  });
});

describe("Tag", () => {
  it("round-trips", () => {
    const tag = { name: "tools", linkCount: 3 };
    expect(Schema.encodeSync(Tag.Tag)(Schema.decodeUnknownSync(Tag.Tag)(tag))).toEqual(tag);
  });

  it("rejects a negative or fractional count", () => {
    expect(() => Schema.decodeUnknownSync(Tag.Tag)({ name: "tools", linkCount: -1 })).toThrow();
    expect(() => Schema.decodeUnknownSync(Tag.Tag)({ name: "tools", linkCount: 1.5 })).toThrow();
  });
});
