import type * as Link from "@stash/contracts-domain/link";
import * as Errors from "@stash/contracts-domain/errors";
import * as Effect from "effect/Effect";
import * as LinksRepo from "../links-repo.ts";

export const notFound = (id: Link.LinkId) => new Errors.NotFound({ resource: "link", id });

/** One link by id. */
export const getLink = Effect.fn("getLink")(function* (id: Link.LinkId) {
  const repo = yield* LinksRepo.LinksRepo;
  return yield* Effect.fromOption(yield* repo.findById(id)).pipe(
    Effect.mapError(() => notFound(id)),
  );
});
