import type * as LinksGroup from "@stash/contracts-api/links";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as LinksRepo from "../links-repo.ts";

/** Page size when the query sets no `limit`. */
export const defaultPageSize = 50;

/** The `cursor` is not one this API handed out. */
export class InvalidCursor extends Data.TaggedError("InvalidCursor")<{
  readonly cursor: string;
}> {}

// A cursor is the position of the last link of a page: `[createdAt, seq]` as base64url JSON.
const CursorJson = Schema.fromJsonString(Schema.Tuple([Schema.String, Schema.Int]));

export const encodeCursor = (position: LinksRepo.ListPosition): string =>
  Base64Url.encode(Schema.encodeSync(CursorJson)([position.createdAt, position.seq]));

export const decodeCursor = (
  cursor: string,
): Effect.Effect<LinksRepo.ListPosition, InvalidCursor> => {
  const json = Base64Url.decodeString(cursor);
  return Result.isFailure(json)
    ? Effect.fail(new InvalidCursor({ cursor }))
    : Schema.decodeUnknownEffect(CursorJson)(json.success).pipe(
        Effect.map(([createdAt, seq]) => ({ createdAt, seq })),
        Effect.mapError(() => new InvalidCursor({ cursor })),
      );
};

/** One page of links, newest first, matching every filter in the query. */
export const listLinks = Effect.fn("listLinks")(function* (query: LinksGroup.ListLinksQuery) {
  const repo = yield* LinksRepo.LinksRepo;
  const limit = query.limit ?? defaultPageSize;
  const after = query.cursor === undefined ? undefined : yield* decodeCursor(query.cursor);
  // One extra row tells whether there is a next page.
  const rows = yield* repo.list({
    ...(query.status === undefined ? {} : { status: query.status }),
    ...(query.type === undefined ? {} : { type: query.type }),
    ...(query.tag === undefined ? {} : { tag: query.tag }),
    ...(query.seen === undefined ? {} : { seen: query.seen }),
    ...(after === undefined ? {} : { after }),
    limit: limit + 1,
  });
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map((row) => row.link),
    nextCursor: rows.length > limit && last !== undefined ? encodeCursor(last.position) : null,
  } satisfies LinksGroup.LinksPage;
});
