import { describe, expect, it } from "@effect/vitest";
import type * as LinksGroup from "@stash/contracts-api/links";
import * as Link from "@stash/contracts-domain/link";
import * as Tag from "@stash/contracts-domain/tag";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";
import * as UpdateLink from "../src/details/update-link.ts";
import * as ListLinks from "../src/list/list-links.ts";
import * as SaveLinksBatch from "../src/save/save-links-batch.ts";
import * as LinksTestLayer from "./links-test-layer.ts";

const url = (value: string) => Link.Url.make(value);
const tag = (value: string) => Tag.TagName.make(value);

/** Saves `count` links one second apart: `https://example.com/0` is the oldest. */
const seed = (count: number) =>
  Effect.forEach(
    Array.from({ length: count }, (_, i) => i),
    (i) =>
      SaveLinksBatch.saveLinks(LinksTestLayer.user, [
        { url: url(`https://example.com/${i}`) },
      ]).pipe(
        Effect.map(([link]) => link!),
        Effect.tap(() => TestClock.adjust("1 second")),
      ),
  );

const urls = (page: LinksGroup.LinksPage) => page.items.map((link) => link.url);

/** Every page, following `nextCursor`. */
const allPages = (query: LinksGroup.ListLinksQuery) =>
  Effect.gen(function* () {
    const pages: Array<LinksGroup.LinksPage> = [];
    let cursor: string | undefined;
    do {
      const page = yield* ListLinks.listLinks(cursor === undefined ? query : { ...query, cursor });
      pages.push(page);
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);
    return pages;
  });

describe("listLinks", () => {
  it.effect("lists newest first with the default page size", () =>
    Effect.gen(function* () {
      yield* seed(3);
      const page = yield* ListLinks.listLinks({});
      expect(urls(page)).toEqual([
        "https://example.com/2",
        "https://example.com/1",
        "https://example.com/0",
      ]);
      expect(page.nextCursor).toBeNull();
    }).pipe(Effect.provide(LinksTestLayer.layer())),
  );

  it.effect("paginates with a cursor until the last page", () =>
    Effect.gen(function* () {
      yield* seed(5);
      const pages = yield* allPages({ limit: 2 });
      expect(pages.map(urls)).toEqual([
        ["https://example.com/4", "https://example.com/3"],
        ["https://example.com/2", "https://example.com/1"],
        ["https://example.com/0"],
      ]);
      expect(pages.at(-1)?.nextCursor).toBeNull();
    }).pipe(Effect.provide(LinksTestLayer.layer())),
  );

  it.effect("returns no cursor when the last page is exactly full", () =>
    Effect.gen(function* () {
      yield* seed(4);
      const pages = yield* allPages({ limit: 2 });
      expect(pages.map((page) => page.items.length)).toEqual([2, 2]);
    }).pipe(Effect.provide(LinksTestLayer.layer())),
  );

  it.effect("keeps a stable order among links saved at the same instant", () =>
    Effect.gen(function* () {
      const saved = yield* SaveLinksBatch.saveLinks(
        LinksTestLayer.user,
        Array.from({ length: 5 }, (_, i) => ({ url: url(`https://example.com/same/${i}`) })),
      );
      const pages = yield* allPages({ limit: 2 });
      expect(pages.flatMap((page) => page.items.map((link) => link.id))).toEqual(
        saved.map((link) => link.id).reverse(),
      );
    }).pipe(Effect.provide(LinksTestLayer.layer())),
  );

  it.effect("filters by status, seen, type and tag, combined with AND", () =>
    Effect.gen(function* () {
      const [a, b, c] = yield* seed(3);
      yield* UpdateLink.updateLink(a!.id, { status: "done", type: "video", tags: [tag("econ")] });
      yield* UpdateLink.updateLink(b!.id, { status: "seen", type: "article", tags: [tag("econ")] });
      yield* UpdateLink.updateLink(c!.id, { type: "video", tags: [tag("tools")] });

      const ids = (query: LinksGroup.ListLinksQuery) =>
        ListLinks.listLinks(query).pipe(Effect.map((page) => page.items.map((link) => link.id)));
      expect(yield* ids({ status: "done" })).toEqual([a!.id]);
      expect(yield* ids({ status: "archived" })).toEqual([]);
      expect(yield* ids({ seen: false })).toEqual([c!.id]);
      expect(yield* ids({ seen: true })).toEqual([b!.id, a!.id]);
      expect(yield* ids({ type: "video" })).toEqual([c!.id, a!.id]);
      expect(yield* ids({ tag: tag("econ") })).toEqual([b!.id, a!.id]);
      expect(yield* ids({ tag: tag("econ"), type: "video" })).toEqual([a!.id]);
      expect(yield* ids({ tag: tag("missing") })).toEqual([]);
    }).pipe(Effect.provide(LinksTestLayer.layer())),
  );

  it.effect("paginates within a filter", () =>
    Effect.gen(function* () {
      const links = yield* seed(5);
      for (const link of links.filter((_, i) => i % 2 === 0)) {
        yield* UpdateLink.updateLink(link.id, { tags: [tag("even")] });
      }
      const pages = yield* allPages({ tag: tag("even"), limit: 2 });
      expect(pages.map(urls)).toEqual([
        ["https://example.com/4", "https://example.com/2"],
        ["https://example.com/0"],
      ]);
    }).pipe(Effect.provide(LinksTestLayer.layer())),
  );

  it.effect("rejects a cursor it did not issue", () =>
    Effect.gen(function* () {
      for (const cursor of [
        "not base64!",
        "bm90IGpzb24",
        ListLinks.encodeCursor({ createdAt: "x", seq: 1 }).slice(1),
      ]) {
        const error = yield* ListLinks.listLinks({ cursor }).pipe(Effect.flip);
        expect(error).toEqual(new ListLinks.InvalidCursor({ cursor }));
      }
    }).pipe(Effect.provide(LinksTestLayer.layer())),
  );
});
