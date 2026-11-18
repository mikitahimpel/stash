import * as Device from "@stash/contracts-domain/device";
import * as Link from "@stash/contracts-domain/link";
import * as Tag from "@stash/contracts-domain/tag";
import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import * as Security from "./security.ts";

export const SearchMode = Schema.Literals(["hybrid", "keyword", "semantic"]);
export type SearchMode = typeof SearchMode.Type;

/**
 * `mode` defaults to `hybrid` on the server. `deviceId` keeps the links saved from that device,
 * and `since` the links saved at or after that moment.
 */
export const SearchQuery = Schema.Struct({
  q: Schema.String.pipe(Schema.check(Schema.isNonEmpty(), Schema.isMaxLength(500))),
  mode: Schema.optionalKey(SearchMode),
  type: Schema.optionalKey(Link.LinkType),
  status: Schema.optionalKey(Link.LinkStatus),
  tag: Schema.optionalKey(Tag.TagName),
  deviceId: Schema.optionalKey(Device.DeviceId),
  since: Schema.optionalKey(Schema.DateTimeUtcFromString),
});
export type SearchQuery = typeof SearchQuery.Type;

/** A match. Higher `score` ranks first; scores compare only within one response. */
export const SearchHit = Schema.Struct({
  link: Link.Link,
  score: Schema.Finite,
});
export type SearchHit = typeof SearchHit.Type;

export const SearchResults = Schema.Struct({
  hits: Schema.Array(SearchHit),
});
export type SearchResults = typeof SearchResults.Type;

export class SearchGroup extends HttpApiGroup.make("search")
  .add(
    HttpApiEndpoint.get("search", "/search", {
      query: SearchQuery,
      success: SearchResults,
    }),
  )
  .middleware(Security.Authorization) {}
