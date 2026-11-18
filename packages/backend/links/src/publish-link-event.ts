import * as LinkEvents from "@stash/backend-platform/link-events";
import type * as Link from "@stash/contracts-domain/link";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as LinksRepo from "./links-repo.ts";

// The events of the live stream (`GET /events`). Every write that changes a stored link sends
// one: an edit or a delete from any client, the cron's auto-archive, enrichment and the metadata
// backfill. A save sends none: a link nobody lists yet changes no row on anyone's screen, and the
// lists pick it up when they load.
//
// None of these can fail, so the write that calls them is safe (see `LinkEvents`).

/** The link changed: `link` is what is stored now. */
export const updated = (link: Link.Link): Effect.Effect<void, never, LinkEvents.LinkEvents> =>
  Effect.gen(function* () {
    const events = yield* LinkEvents.LinkEvents;
    yield* events.publish({ type: "link.updated", at: yield* DateTime.now, link });
  });

/** The link is gone. */
export const deleted = (id: Link.LinkId): Effect.Effect<void, never, LinkEvents.LinkEvents> =>
  Effect.gen(function* () {
    const events = yield* LinkEvents.LinkEvents;
    yield* events.publish({ type: "link.deleted", at: yield* DateTime.now, id });
  });

/**
 * The link changed, for a writer that does not hold the whole link (enrichment writes columns):
 * reads it and sends it. A link that is gone, or a read that fails, sends nothing.
 */
export const changed = (
  id: Link.LinkId,
): Effect.Effect<void, never, LinkEvents.LinkEvents | LinksRepo.LinksRepo> =>
  Effect.gen(function* () {
    const repo = yield* LinksRepo.LinksRepo;
    const link = yield* repo.findById(id);
    if (Option.isSome(link)) yield* updated(link.value);
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning(`link events: ${id} was not read for its update`, cause),
    ),
  );
