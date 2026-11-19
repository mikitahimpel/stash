import { describe, expect, it } from "@effect/vitest";
import * as D1Database from "@stash/backend-platform/d1-database";
import * as LinkEvents from "@stash/backend-platform/link-events";
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
const published = Effect.flatMap(Testing.TestLinkEvents, (events) => events.published);

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
        imageUrl: null,
        author: null,
        enrichedAt: null,
        updatedAt: saved.updatedAt,
        created: true,
      });
      expect(saved.updatedAt).toBeDefined();
      expect(yield* drain).toEqual([{ linkId: saved.id }]);
    }).pipe(Effect.provide(LinksTestLayer.layer())),
  );

  it.effect("announces a new link on the live stream once, and a repeat save not at all", () =>
    Effect.gen(function* () {
      const { created: _, ...link } = yield* SaveLink.saveLink(LinksTestLayer.device, {
        url: url("https://example.com/live"),
        title: "Saved on the phone",
      });
      // The whole link, so an Inbox open on another device can show it at once.
      expect(yield* published).toEqual([{ type: "link.updated", at: yield* DateTime.now, link }]);
      const again = yield* SaveLink.saveLink(LinksTestLayer.user, {
        url: url("https://www.example.com/live/"),
      });
      expect(again.created).toBe(false);
      expect(yield* published).toHaveLength(1);
    }).pipe(Effect.provide(LinksTestLayer.layer())),
  );

  it.effect("saves the link when the stream cannot be reached", () =>
    Effect.gen(function* () {
      const saved = yield* SaveLink.saveLink(LinksTestLayer.device, {
        url: url("https://example.com/live"),
      });
      expect(saved.created).toBe(true);
      expect(yield* drain).toEqual([{ linkId: saved.id }]);
    }).pipe(
      // The object behind the stream rejects every call, as when it is overloaded or gone.
      Effect.provide(
        LinkEvents.layer(
          {
            idFromName: (name) => name,
            get: () => ({ fetch: () => Promise.reject(new Error("stream is closed")) }),
          },
          "example-user",
        ),
      ),
      Effect.provide(LinksTestLayer.layer()),
    ),
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
      expect(first.created).toBe(true);
      // Created by the first save, not this one: a client must not offer Undo for it.
      expect(again).toEqual({ ...first, created: false });
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
      const { created: _, ...existing } = yield* SaveLink.saveLink(LinksTestLayer.user, {
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
      // The links this batch created, each once, in order (after the first save's own event).
      expect((yield* published).slice(1)).toEqual([
        { type: "link.updated", at: yield* DateTime.now, link: saved[0] },
        { type: "link.updated", at: yield* DateTime.now, link: saved[2] },
      ]);
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
