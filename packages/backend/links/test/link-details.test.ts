import { describe, expect, it } from "@effect/vitest";
import * as D1Database from "@stash/backend-platform/d1-database";
import * as Errors from "@stash/contracts-domain/errors";
import * as Link from "@stash/contracts-domain/link";
import * as Tag from "@stash/contracts-domain/tag";
import * as Effect from "effect/Effect";
import * as DeleteLink from "../src/details/delete-link.ts";
import * as GetLink from "../src/details/get-link.ts";
import * as UpdateLink from "../src/details/update-link.ts";
import * as ListLinks from "../src/list/list-links.ts";
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
      expect(statusOnly).toEqual({ ...saved, status: "seen" });

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
      });
      expect(yield* UpdateLink.updateLink(saved.id, {})).toEqual(updated);
      expect(yield* UpdateLink.updateLink(saved.id, { tags: [] })).toEqual({
        ...updated,
        tags: [],
      });
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
});
