import type * as Link from "@stash/contracts-domain/link";
import * as Effect from "effect/Effect";
import * as LinksRepo from "../links-repo.ts";
import * as PublishLinkEvent from "../publish-link-event.ts";
import * as GetLink from "./get-link.ts";

/** Deletes a link and its tag assignments, and tells the live stream. */
export const deleteLink = Effect.fn("deleteLink")(function* (id: Link.LinkId) {
  const repo = yield* LinksRepo.LinksRepo;
  if (!(yield* repo.remove(id))) return yield* GetLink.notFound(id);
  yield* PublishLinkEvent.deleted(id);
});
