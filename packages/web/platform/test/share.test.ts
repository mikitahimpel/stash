import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Share from "../src/share.ts";
import * as Testing from "../src/testing.ts";

const data: Share.ShareData = { title: "Example", url: "https://example.com/article" };

afterEach(() => {
  vi.unstubAllGlobals();
});

const reasonFor = (error: unknown) =>
  Effect.gen(function* () {
    vi.stubGlobal("navigator", { share: () => Promise.reject(error) });
    const share = yield* Share.Share;
    return yield* share.share(data).pipe(
      Effect.flip,
      Effect.map((e) => e.reason),
    );
  }).pipe(Effect.provide(Share.layer));

describe("Share (live)", () => {
  it.effect("calls navigator.share", () => {
    const shared: Array<unknown> = [];
    vi.stubGlobal("navigator", {
      share: async (value: unknown) => {
        shared.push(value);
      },
      canShare: () => true,
    });
    return Effect.gen(function* () {
      const share = yield* Share.Share;
      expect(yield* share.canShare(data)).toBe(true);
      yield* share.share(data);
      expect(shared).toEqual([data]);
    }).pipe(Effect.provide(Share.layer));
  });

  it.effect("fails with Unsupported without the Web Share API", () => {
    vi.stubGlobal("navigator", {});
    return Effect.gen(function* () {
      const share = yield* Share.Share;
      expect(yield* share.canShare(data)).toBe(false);
      const error = yield* Effect.flip(share.share(data));
      expect(error.reason).toBe("Unsupported");
    }).pipe(Effect.provide(Share.layer));
  });

  it.effect("fails with Unsupported when canShare rejects the data", () => {
    vi.stubGlobal("navigator", { share: async () => {}, canShare: () => false });
    return Effect.gen(function* () {
      const share = yield* Share.Share;
      const error = yield* Effect.flip(share.share(data));
      expect(error.reason).toBe("Unsupported");
    }).pipe(Effect.provide(Share.layer));
  });

  it.effect("maps browser errors to reasons", () =>
    Effect.gen(function* () {
      expect(yield* reasonFor(new DOMException("cancelled", "AbortError"))).toBe("Aborted");
      expect(yield* reasonFor(new DOMException("no gesture", "NotAllowedError"))).toBe(
        "NotAllowed",
      );
      expect(yield* reasonFor(new Error("boom"))).toBe("Failed");
    }),
  );
});

describe("Share (in memory)", () => {
  it.effect("records what is shared", () =>
    Effect.gen(function* () {
      const share = yield* Share.Share;
      const test = yield* Testing.TestShare;
      expect(yield* share.canShare(data)).toBe(true);
      yield* share.share(data);
      expect(yield* test.shared).toEqual([data]);
    }).pipe(Effect.provide(Testing.layerShare())),
  );

  it.effect("can act like a browser without the Web Share API", () =>
    Effect.gen(function* () {
      const share = yield* Share.Share;
      const test = yield* Testing.TestShare;
      expect(yield* share.canShare(data)).toBe(false);
      const error = yield* Effect.flip(share.share(data));
      expect(error.reason).toBe("Unsupported");
      expect(yield* test.shared).toEqual([]);
    }).pipe(Effect.provide(Testing.layerShare({ supported: false }))),
  );
});
