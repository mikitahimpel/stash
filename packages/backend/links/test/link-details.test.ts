import { describe, expect, it } from "@effect/vitest";
import * as D1Database from "@stash/backend-platform/d1-database";
import * as LinkEvents from "@stash/backend-platform/link-events";
import * as Testing from "@stash/backend-platform/testing";
import * as Errors from "@stash/contracts-domain/errors";
import * as Link from "@stash/contracts-domain/link";
import * as Tag from "@stash/contracts-domain/tag";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as DeleteLink from "../src/details/delete-link.ts";
import * as GetLink from "../src/details/get-link.ts";
import * as UpdateLink from "../src/details/update-link.ts";
import * as ListLinks from "../src/list/list-links.ts";
import * as PublishLinkEvent from "../src/publish-link-event.ts";
import * as SaveLink from "../src/save/save-link.ts";
import * as LinksTestLayer from "./links-test-layer.ts";

const tag = (value: string) => Tag.TagName.make(value);
const missing = Link.LinkId.make("link-missing");
const notFound = new Errors.NotFound({ resource: "link", id: "link-missing" });

const save = SaveLink.saveLink(LinksTestLayer.user, {
  url: Link.Url.make("https://example.com/details"),
  title: "Original",
  tags: [tag("a"), tag("b")],
}).pipe(
  Effect.map((saved) => {
    const { created: _, ...link } = saved;
    return link;
  }),
);

const published = Effect.flatMap(Testing.TestLinkEvents, (events) => events.published);

/** Puts the link's last change at `at`, as if it happened then. */
const changedAt = (id: Link.LinkId, at: string) =>
  D1Database.Database.use((db) =>
    db.run(D1Database.sql`UPDATE links SET updated_at = ${at} WHERE id = ${id}`),
  );

describe("link details", () => {
  it.effect("gets a link by id, or fails with NotFound", () =>
    Effect.gen(function* () {
      const saved = yield* save;
      expect(yield* GetLink.getLink(saved.id)).toEqual(saved);
      expect(yield* GetLink.getLink(missing).pipe(Effect.flip)).toEqual(notFound);
    }).pipe(Effect.provide(LinksTestLayer.layer())),
  );

  it.effect("answers the post enrichment stored, and no post for JSON it cannot read", () =>
    Effect.gen(function* () {
      const saved = yield* save;
      expect(saved).not.toHaveProperty("post");
      const post = {
        state: "available",
        id: "1700000000000000001",
        url: "https://x.com/example_writer/status/1700000000000000001",
        author: {
          name: "Example Writer",
          handle: "example_writer",
          avatarUrl: null,
          verified: false,
        },
        text: "An example post",
        entities: [],
        createdAt: "2026-01-02T03:04:05.000Z",
        media: [],
        replyTo: null,
        counts: null,
        long: false,
        quoted: null,
      };
      const store = (json: string) =>
        D1Database.Database.use((db) =>
          db.run(D1Database.sql`UPDATE links SET post = ${json} WHERE id = ${saved.id}`),
        );
      yield* store(JSON.stringify(post));
      expect((yield* GetLink.getLink(saved.id)).post).toMatchObject({
        state: "available",
        text: "An example post",
        author: { handle: "example_writer" },
      });
      const page = yield* ListLinks.listLinks({});
      expect(page.items.map((link) => link.post?.state)).toEqual(["available"]);

      yield* store(JSON.stringify({ state: "unavailable", id: post.id, url: post.url }));
      expect((yield* GetLink.getLink(saved.id)).post).toEqual({
        state: "unavailable",
        id: post.id,
        url: post.url,
      });

      yield* store('{"state": "from another version"}');
      expect(yield* GetLink.getLink(saved.id)).not.toHaveProperty("post");
    }).pipe(Effect.provide(LinksTestLayer.layer())),
  );

  it.effect("answers the preview image enrichment stored, in details and in the list", () =>
    Effect.gen(function* () {
      const saved = yield* save;
      expect(saved.imageUrl).toBeNull();
      const imageUrl = "https://example.com/details.png";
      yield* D1Database.Database.use((db) =>
        db.run(D1Database.sql`UPDATE links SET image_url = ${imageUrl} WHERE id = ${saved.id}`),
      );
      expect((yield* GetLink.getLink(saved.id)).imageUrl).toBe(imageUrl);
      const page = yield* ListLinks.listLinks({});
      expect(page.items.map((link) => link.imageUrl)).toEqual([imageUrl]);
    }).pipe(Effect.provide(LinksTestLayer.layer())),
  );

  it.effect("patches only the given fields and replaces tags", () =>
    Effect.gen(function* () {
      const saved = yield* save;
      const statusOnly = yield* UpdateLink.updateLink(saved.id, { status: "seen" });
      expect(statusOnly).toEqual({ ...saved, status: "seen", updatedAt: statusOnly.updatedAt });

      const updated = yield* UpdateLink.updateLink(saved.id, {
        title: "Renamed",
        type: "article",
        tags: [tag("c"), tag("a")],
      });
      expect(updated).toEqual({
        ...saved,
        status: "seen",
        title: "Renamed",
        type: "article",
        tags: ["a", "c"],
        updatedAt: updated.updatedAt,
      });
      expect(yield* UpdateLink.updateLink(saved.id, {})).toEqual(updated);
      const untagged = yield* UpdateLink.updateLink(saved.id, { tags: [] });
      expect(untagged).toEqual({ ...updated, tags: [], updatedAt: untagged.updatedAt });
      expect(yield* UpdateLink.updateLink(missing, { title: "x" }).pipe(Effect.flip)).toEqual(
        notFound,
      );
    }).pipe(Effect.provide(LinksTestLayer.layer())),
  );

  it.effect("deletes a link with its tag assignments, then fails with NotFound", () =>
    Effect.gen(function* () {
      const saved = yield* save;
      yield* DeleteLink.deleteLink(saved.id);
      expect(yield* GetLink.getLink(saved.id).pipe(Effect.flip)).toEqual(
        new Errors.NotFound({ resource: "link", id: saved.id }),
      );
      const linkTags = yield* D1Database.Database.use((db) =>
        db.all(D1Database.sql`SELECT * FROM link_tags`),
      );
      expect(linkTags).toEqual([]);
      expect(yield* DeleteLink.deleteLink(saved.id).pipe(Effect.flip)).toEqual(
        new Errors.NotFound({ resource: "link", id: saved.id }),
      );
    }).pipe(Effect.provide(LinksTestLayer.layer())),
  );

  it.effect("stamps a link when it is saved and again with every change", () =>
    Effect.gen(function* () {
      const saved = yield* save;
      expect(saved.updatedAt).toBeDefined();
      yield* changedAt(saved.id, "2026-01-02T03:04:05.000Z");
      const at = (link: Link.Link) => DateTime.formatIso(link.updatedAt!);
      expect(at(yield* GetLink.getLink(saved.id))).toBe("2026-01-02T03:04:05.000Z");

      // A field, the tags alone, and what enrichment writes: each moves the stamp.
      const seen = yield* UpdateLink.updateLink(saved.id, { status: "seen" });
      expect(at(seen) > "2026-01-02T03:04:05.000Z").toBe(true);
      yield* changedAt(saved.id, "2026-01-02T03:04:05.000Z");
      expect(at(yield* UpdateLink.updateLink(saved.id, { tags: [tag("c")] }))).not.toBe(
        "2026-01-02T03:04:05.000Z",
      );
      yield* changedAt(saved.id, "2026-01-02T03:04:05.000Z");
      yield* D1Database.Database.use((db) =>
        db.run(D1Database.sql`UPDATE links SET summary = ${"A summary."} WHERE id = ${saved.id}`),
      );
      expect(at(yield* GetLink.getLink(saved.id))).not.toBe("2026-01-02T03:04:05.000Z");
    }).pipe(Effect.provide(LinksTestLayer.layer())),
  );
});

describe("link events", () => {
  it.effect("publishes the whole link once for an update", () =>
    Effect.gen(function* () {
      const saved = yield* save;
      const updated = yield* UpdateLink.updateLink(saved.id, { status: "done" });
      // After the save's own event.
      expect((yield* published).slice(1)).toEqual([
        { type: "link.updated", at: yield* DateTime.now, link: updated },
      ]);
    }).pipe(Effect.provide(LinksTestLayer.layer())),
  );

  it.effect("publishes the id once for a delete, and nothing for a link that is not there", () =>
    Effect.gen(function* () {
      const saved = yield* save;
      yield* DeleteLink.deleteLink(saved.id);
      yield* DeleteLink.deleteLink(saved.id).pipe(Effect.flip);
      yield* UpdateLink.updateLink(missing, { status: "seen" }).pipe(Effect.flip);
      expect((yield* published).slice(1)).toEqual([
        { type: "link.deleted", at: yield* DateTime.now, id: saved.id },
      ]);
    }).pipe(Effect.provide(LinksTestLayer.layer())),
  );

  it.effect("reads and publishes a link another writer changed", () =>
    Effect.gen(function* () {
      const saved = yield* save;
      yield* D1Database.Database.use((db) =>
        db.run(D1Database.sql`UPDATE links SET summary = ${"A summary."} WHERE id = ${saved.id}`),
      );
      yield* PublishLinkEvent.changed(saved.id);
      yield* PublishLinkEvent.changed(missing);
      const events = (yield* published).slice(1);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ type: "link.updated", link: { summary: "A summary." } });
    }).pipe(Effect.provide(LinksTestLayer.layer())),
  );

  it.effect("keeps the write when the stream cannot be reached", () =>
    Effect.gen(function* () {
      const saved = yield* save;
      const updated = yield* UpdateLink.updateLink(saved.id, { status: "done" });
      expect(updated.status).toBe("done");
      expect((yield* GetLink.getLink(saved.id)).status).toBe("done");
      yield* DeleteLink.deleteLink(saved.id);
      expect(yield* GetLink.getLink(saved.id).pipe(Effect.flip)).toEqual(
        new Errors.NotFound({ resource: "link", id: saved.id }),
      );
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
});
