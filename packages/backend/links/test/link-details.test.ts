import { describe, expect, it } from "@effect/vitest";
import * as D1Database from "@stash/backend-platform/d1-database";
import * as Errors from "@stash/contracts-domain/errors";
import * as Link from "@stash/contracts-domain/link";
import * as Tag from "@stash/contracts-domain/tag";
import * as Effect from "effect/Effect";
import * as DeleteLink from "../src/details/delete-link.ts";
import * as GetLink from "../src/details/get-link.ts";
import * as UpdateLink from "../src/details/update-link.ts";
import * as SaveLink from "../src/save/save-link.ts";
import * as LinksTestLayer from "./links-test-layer.ts";

const tag = (value: string) => Tag.TagName.make(value);
const missing = Link.LinkId.make("link-missing");
const notFound = new Errors.NotFound({ resource: "link", id: "link-missing" });

const save = SaveLink.saveLink(LinksTestLayer.user, {
  url: Link.Url.make("https://example.com/details"),
  title: "Original",
  tags: [tag("a"), tag("b")],
});

describe("link details", () => {
  it.effect("gets a link by id, or fails with NotFound", () =>
    Effect.gen(function* () {
      const saved = yield* save;
      expect(yield* GetLink.getLink(saved.id)).toEqual(saved);
      expect(yield* GetLink.getLink(missing).pipe(Effect.flip)).toEqual(notFound);
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
