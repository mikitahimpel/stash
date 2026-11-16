import { describe, expect, it } from "@effect/vitest";
import * as D1Database from "@stash/backend-platform/d1-database";
import * as Testing from "@stash/backend-platform/testing";
import * as Device from "@stash/contracts-domain/device";
import * as Errors from "@stash/contracts-domain/errors";
import * as Link from "@stash/contracts-domain/link";
import * as Tag from "@stash/contracts-domain/tag";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";
import * as SaveLink from "../src/save/save-link.ts";
import * as SaveLinksBatch from "../src/save/save-links-batch.ts";
import * as LinksTestLayer from "./links-test-layer.ts";

const url = (value: string) => Link.Url.make(value);
const tag = (value: string) => Tag.TagName.make(value);

const drain = Testing.TestEnrichmentQueue.use((queue) => queue.drain);

describe("saveLink", () => {
  it.effect("stores a new link and enqueues it for enrichment", () =>
    Effect.gen(function* () {
      const saved = yield* SaveLink.saveLink(LinksTestLayer.device, {
        url: url("https://www.example.com/post/?utm_source=feed"),
        title: "A synthetic post",
        tags: [tag("reading"), tag("economics"), tag("reading")],
      });
      expect(saved).toEqual({
        id: saved.id,
        url: "https://www.example.com/post/?utm_source=feed",
        canonicalUrl: "https://example.com/post",
        title: "A synthetic post",
        status: "new",
        type: null,
        summary: null,
        language: null,
        tags: ["economics", "reading"],
        sourceDeviceId: LinksTestLayer.deviceId,
        createdAt: yield* DateTime.now,
        enrichedAt: null,
      });
      expect(yield* drain).toEqual([{ linkId: saved.id }]);
    }).pipe(Effect.provide(LinksTestLayer.layer())),
  );

  it.effect("returns the existing link for a duplicate canonical URL and enqueues nothing", () =>
    Effect.gen(function* () {
      const first = yield* SaveLink.saveLink(LinksTestLayer.device, {
        url: url("https://example.com/video"),
      });
      yield* drain;

      const again = yield* SaveLink.saveLink(LinksTestLayer.user, {
        url: url("https://www.example.com/video/?fbclid=abc#comments"),
        title: "Another title",
      });
      expect(again).toEqual(first);
      expect(yield* drain).toEqual([]);

      const rows = yield* D1Database.Database.use((db) =>
        db.all(D1Database.sql`SELECT id FROM links`),
      );
      expect(rows).toEqual([{ id: first.id }]);
    }).pipe(Effect.provide(LinksTestLayer.layer())),
  );

  it.effect("attributes a session save to the named device, and ignores an unknown one", () =>
    Effect.gen(function* () {
      const named = yield* SaveLink.saveLink(LinksTestLayer.user, {
        url: url("https://example.com/from-iphone"),
        deviceId: LinksTestLayer.deviceId,
      });
      expect(named.sourceDeviceId).toBe(LinksTestLayer.deviceId);

      const unknown = yield* SaveLink.saveLink(LinksTestLayer.user, {
        url: url("https://example.com/from-nowhere"),
        deviceId: Device.DeviceId.make("device-missing"),
      });
      expect(unknown.sourceDeviceId).toBeNull();

      // A device token wins over a named device.
      const other = yield* SaveLink.saveLink(LinksTestLayer.device, {
        url: url("https://example.com/from-zen"),
        deviceId: Device.DeviceId.make("device-missing"),
      });
      expect(other.sourceDeviceId).toBe(LinksTestLayer.deviceId);
    }).pipe(Effect.provide(LinksTestLayer.layer())),
  );

  it.effect("records the device's latest save, a repeat save included", () =>
    Effect.gen(function* () {
      const lastSave = D1Database.Database.use((db) =>
        db.first(
          D1Database.sql`SELECT last_save_at AS at, last_save_link_id AS linkId FROM devices
            WHERE id = ${LinksTestLayer.deviceId}`,
        ),
      );
      const first = yield* SaveLink.saveLink(LinksTestLayer.user, {
        url: url("https://example.com/first"),
      });
      expect(yield* lastSave).toEqual(Option.some({ at: null, linkId: null }));

      yield* TestClock.adjust("1 minute");
      yield* SaveLink.saveLink(LinksTestLayer.device, { url: url("https://example.com/first") });
      expect(yield* lastSave).toEqual(
        Option.some({ at: DateTime.formatIso(yield* DateTime.now), linkId: first.id }),
      );
    }).pipe(Effect.provide(LinksTestLayer.layer())),
  );

  it.effect("dedupes YouTube short links against the watch URL", () =>
    Effect.gen(function* () {
      const watch = yield* SaveLink.saveLink(LinksTestLayer.user, {
        url: url("https://www.youtube.com/watch?v=abc123"),
      });
      const short = yield* SaveLink.saveLink(LinksTestLayer.user, {
        url: url("https://youtu.be/abc123?si=share"),
      });
      expect(short.id).toBe(watch.id);
      expect(watch.sourceDeviceId).toBeNull();
    }).pipe(Effect.provide(LinksTestLayer.layer())),
  );

  it.effect("fails with RateLimited once the principal's window is used up", () =>
    Effect.gen(function* () {
      yield* SaveLink.saveLink(LinksTestLayer.device, { url: url("https://example.com/1") });
      yield* SaveLink.saveLink(LinksTestLayer.device, { url: url("https://example.com/2") });
      yield* drain;
      const error = yield* SaveLink.saveLink(LinksTestLayer.device, {
        url: url("https://example.com/3"),
      }).pipe(Effect.flip);
      expect(error).toEqual(new Errors.RateLimited({ retryAfterSeconds: 60 }));
      expect(yield* drain).toEqual([]);
    }).pipe(Effect.provide(LinksTestLayer.layer({ limit: 2, windowSeconds: 60 }))),
  );
});

describe("saveLinksBatch", () => {
  it.effect("returns one link per input in order, deduping within the batch and the store", () =>
    Effect.gen(function* () {
      const existing = yield* SaveLink.saveLink(LinksTestLayer.user, {
        url: url("https://example.com/existing"),
      });
      yield* drain;

      const saved = yield* SaveLinksBatch.saveLinksBatch(LinksTestLayer.device, [
        { url: url("https://example.com/a"), tags: [tag("one")] },
        { url: url("https://example.com/existing/?utm_medium=x") },
        { url: url("https://example.com/b"), title: "B", tags: [tag("one"), tag("two")] },
        { url: url("https://www.example.com/a/"), tags: [tag("ignored")] },
      ]);
      expect(saved.map((link) => link.url)).toEqual([
        "https://example.com/a",
        "https://example.com/existing",
        "https://example.com/b",
        "https://example.com/a",
      ]);
      expect(saved[1]).toEqual(existing);
      expect(saved[3]).toEqual(saved[0]);
      expect(saved[0]?.tags).toEqual(["one"]);
      expect(saved[2]).toMatchObject({ title: "B", tags: ["one", "two"] });

      expect(yield* drain).toEqual([{ linkId: saved[0]?.id }, { linkId: saved[2]?.id }]);
      const tags = yield* D1Database.Database.use((db) =>
        db.all(D1Database.sql`SELECT name FROM tags ORDER BY name`),
      );
      expect(tags).toEqual([{ name: "one" }, { name: "two" }]);
    }).pipe(Effect.provide(LinksTestLayer.layer())),
  );

  it.effect("counts a whole batch as one save against the rate limit", () =>
    Effect.gen(function* () {
      const saved = yield* SaveLinksBatch.saveLinksBatch(
        LinksTestLayer.device,
        Array.from({ length: 5 }, (_, i) => ({ url: url(`https://example.com/batch/${i}`) })),
      );
      expect(saved).toHaveLength(5);
      const error = yield* SaveLinksBatch.saveLinksBatch(LinksTestLayer.device, [
        { url: url("https://example.com/later") },
      ]).pipe(Effect.flip);
      expect(error._tag).toBe("RateLimited");
    }).pipe(Effect.provide(LinksTestLayer.layer({ limit: 1, windowSeconds: 60 }))),
  );
});
