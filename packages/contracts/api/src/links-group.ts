import * as Link from "@stash/contracts-domain/link";
import * as Tag from "@stash/contracts-domain/tag";
import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api";
import * as ErrorStatuses from "./error-statuses.ts";
import * as Security from "./security.ts";

/** The most links one `POST /links/batch` call may carry. */
export const maxBatchSize = 500;

/** The most links one page of `GET /links` returns. */
export const maxPageSize = 100;

export const SaveLinksBatch = Schema.Struct({
  links: Schema.Array(Link.SaveLinkInput).pipe(
    Schema.check(Schema.isBetweenLength(1, maxBatchSize)),
  ),
});
export type SaveLinksBatch = typeof SaveLinksBatch.Type;

export const SavedLinks = Schema.Struct({
  links: Schema.Array(Link.Link),
});
export type SavedLinks = typeof SavedLinks.Type;

export const LinksSort = Schema.Literals(["recent"]);
export type LinksSort = typeof LinksSort.Type;

export const PageSize = Schema.Int.pipe(
  Schema.check(Schema.isBetween({ minimum: 1, maximum: maxPageSize })),
);

/**
 * Filters for `GET /links`. All are optional and combine with AND. `seen: false` means links still
 * in status `new`. `cursor` is the opaque `nextCursor` of the previous page.
 */
export const ListLinksQuery = Schema.Struct({
  status: Schema.optionalKey(Link.LinkStatus),
  type: Schema.optionalKey(Link.LinkType),
  tag: Schema.optionalKey(Tag.TagName),
  seen: Schema.optionalKey(Schema.Boolean),
  cursor: Schema.optionalKey(Schema.String.pipe(Schema.check(Schema.isNonEmpty()))),
  limit: Schema.optionalKey(PageSize),
  sort: Schema.optionalKey(LinksSort),
});
export type ListLinksQuery = typeof ListLinksQuery.Type;

/** One page of links. `nextCursor` is null on the last page. */
export const LinksPage = Schema.Struct({
  items: Schema.Array(Link.Link),
  nextCursor: Schema.NullOr(Schema.String),
});
export type LinksPage = typeof LinksPage.Type;

const LinkIdParams = { id: Link.LinkId };

export class LinksGroup extends HttpApiGroup.make("links")
  .add(
    // Answers as soon as the link is stored. Enrichment runs later.
    HttpApiEndpoint.post("save", "/links", {
      payload: Link.SaveLinkInput,
      success: Link.Link.pipe(HttpApiSchema.status(201)),
      error: ErrorStatuses.RateLimited,
    }),
    HttpApiEndpoint.post("saveBatch", "/links/batch", {
      payload: SaveLinksBatch,
      success: SavedLinks.pipe(HttpApiSchema.status(201)),
      error: ErrorStatuses.RateLimited,
    }),
    HttpApiEndpoint.get("list", "/links", {
      query: ListLinksQuery,
      success: LinksPage,
    }),
    HttpApiEndpoint.get("get", "/links/:id", {
      params: LinkIdParams,
      success: Link.Link,
      error: ErrorStatuses.NotFound,
    }),
    HttpApiEndpoint.patch("update", "/links/:id", {
      params: LinkIdParams,
      payload: Link.LinkPatch,
      success: Link.Link,
      error: ErrorStatuses.NotFound,
    }),
    HttpApiEndpoint.delete("remove", "/links/:id", {
      params: LinkIdParams,
      success: HttpApiSchema.NoContent,
      error: ErrorStatuses.NotFound,
    }),
  )
  .middleware(Security.Authorization) {}
