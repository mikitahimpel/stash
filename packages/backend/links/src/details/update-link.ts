import type * as Link from "@stash/contracts-domain/link";
import * as Effect from "effect/Effect";
import * as LinksRepo from "../links-repo.ts";
import * as PublishLinkEvent from "../publish-link-event.ts";
import * as GetLink from "./get-link.ts";

/**
 * Applies a partial update and tells the live stream. Omitted fields stay unchanged, and `tags`
 * replaces every tag.
 */
export const updateLink = Effect.fn("updateLink")(function* (
  id: Link.LinkId,
  patch: Link.LinkPatch,
) {
  const repo = yield* LinksRepo.LinksRepo;
  const link = yield* Effect.fromOption(yield* repo.update(id, patch)).pipe(
    Effect.mapError(() => GetLink.notFound(id)),
  );
  yield* PublishLinkEvent.updated(link);
  return link;
});
