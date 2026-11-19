import * as LinkEvents from "@stash/backend-platform/link-events";
import * as Security from "@stash/contracts-api/security";
import type * as Link from "@stash/contracts-domain/link";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as LinksRepo from "./links-repo.ts";

// The events of the live stream (`GET /events`). Every write that changes a stored link sends
// one: an edit or a delete from any client, the cron's auto-archive, enrichment and the metadata
// backfill, and a save: a link saved on the phone shows up in an Inbox that is open elsewhere.
//
// Each goes to the current user (`CurrentUser`) and to nobody else: the user whose link it is,
// since a link is only ever read or written as its user.
//
// None of these can fail, so the write that calls them is safe (see `LinkEvents`).

/** The link changed: `link` is what is stored now. */
export const updated = (
  link: Link.Link,
): Effect.Effect<void, never, LinkEvents.LinkEvents | Security.CurrentUser> =>
  Effect.gen(function* () {
    const events = yield* LinkEvents.LinkEvents;
    const user = yield* Security.CurrentUser;
    yield* events.publish(user.id, { type: "link.updated", at: yield* DateTime.now, link });
  });

/** The most links of one batch save that are announced. An import past that is picked up by the lists. */
export const maxSavedEvents = 100;

/**
 * These links were just saved: one `link.updated` each, in one call. Past `maxSavedEvents` only
 * the first ones are sent.
 */
export const saved = (
  links: ReadonlyArray<Link.Link>,
): Effect.Effect<void, never, LinkEvents.LinkEvents | Security.CurrentUser> =>
  Effect.gen(function* () {
    if (links.length === 0) return;
    const events = yield* LinkEvents.LinkEvents;
    const user = yield* Security.CurrentUser;
    const at = yield* DateTime.now;
    yield* events.publishAll(
      user.id,
      links.slice(0, maxSavedEvents).map((link) => ({ type: "link.updated" as const, at, link })),
    );
  });

/** The link is gone. */
export const deleted = (
  id: Link.LinkId,
): Effect.Effect<void, never, LinkEvents.LinkEvents | Security.CurrentUser> =>
  Effect.gen(function* () {
    const events = yield* LinkEvents.LinkEvents;
    const user = yield* Security.CurrentUser;
    yield* events.publish(user.id, { type: "link.deleted", at: yield* DateTime.now, id });
  });

/**
 * The link changed, for a writer that does not hold the whole link (enrichment writes columns):
 * reads it and sends it. A link that is gone, or a read that fails, sends nothing.
 */
export const changed = (
  id: Link.LinkId,
): Effect.Effect<void, never, LinkEvents.LinkEvents | LinksRepo.LinksRepo | Security.CurrentUser> =>
  Effect.gen(function* () {
    const repo = yield* LinksRepo.LinksRepo;
    const link = yield* repo.findById(id);
    if (Option.isSome(link)) yield* updated(link.value);
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning(`link events: ${id} was not read for its update`, cause),
    ),
  );
