import { describe, expect, it } from "@effect/vitest";
import * as Blobs from "@stash/backend-platform/blobs";
import * as PlatformTesting from "@stash/backend-platform/testing";
import * as Link from "@stash/contracts-domain/link";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as StoreText from "../src/store-text.ts";

const id = Schema.decodeSync(Link.LinkId)("link-1");

describe("StoreText", () => {
  it("keys text by link id", () => {
    expect(StoreText.key(id)).toBe("links/link-1.txt");
  });

  it.effect("writes UTF-8 text and reads it back", () =>
    Effect.gen(function* () {
      expect(yield* StoreText.readText(id)).toEqual(Option.none());
      yield* StoreText.storeText(id, "first");
      yield* StoreText.storeText(id, "Grüße — 你好");
      expect(yield* StoreText.readText(id)).toEqual(Option.some("Grüße — 你好"));
      const blob = yield* Blobs.Blobs.use((blobs) => blobs.get("links/link-1.txt"));
      expect(Option.map(blob, (b) => b.contentType)).toEqual(
        Option.some(Option.some("text/plain; charset=utf-8")),
      );
    }).pipe(Effect.provide(PlatformTesting.layerBlobs)),
  );
});
