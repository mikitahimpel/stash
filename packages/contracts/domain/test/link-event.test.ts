import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import * as LinkEvent from "../src/link-event.ts";

const link = {
  id: "link-1",
  url: "https://example.com/articles/one",
  canonicalUrl: "https://example.com/articles/one",
  title: "An invented article",
  status: "new",
  type: "article",
  summary: "What the invented article says.",
  language: "en",
  imageUrl: null,
  author: null,
  tags: ["economics"],
  sourceDeviceId: null,
  createdAt: "2026-01-02T03:04:05.000Z",
  enrichedAt: "2026-01-02T03:04:09.000Z",
  updatedAt: "2026-01-02T03:04:09.120Z",
};
const at = "2026-01-02T03:04:09.200Z";

describe("LinkEvent", () => {
  it("round-trips every event as the text of one message", () => {
    for (const event of [
      { type: "link.updated", at, link },
      { type: "link.deleted", at, id: "link-1" },
      { type: "stream.ready", at },
    ]) {
      const decoded = Schema.decodeUnknownSync(LinkEvent.LinkEventFromJson)(JSON.stringify(event));
      expect(decoded.type).toBe(event.type);
      expect(JSON.parse(Schema.encodeSync(LinkEvent.LinkEventFromJson)(decoded))).toEqual(event);
    }
  });

  it("carries the whole link on an update", () => {
    const decoded = Schema.decodeUnknownSync(LinkEvent.LinkEvent)({
      type: "link.updated",
      at,
      link,
    });
    expect(decoded.type === "link.updated" && decoded.link.summary).toBe(
      "What the invented article says.",
    );
  });

  it("rejects an unknown type, a partial link and text that is not JSON", () => {
    const decode = Schema.decodeUnknownOption(LinkEvent.LinkEventFromJson);
    expect(decode(JSON.stringify({ type: "link.created", at, link }))._tag).toBe("None");
    expect(decode(JSON.stringify({ type: "link.updated", at, link: { id: "link-1" } }))._tag).toBe(
      "None",
    );
    expect(decode(LinkEvent.pong)._tag).toBe("None");
  });
});
