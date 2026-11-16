import * as EnrichmentQueue from "@stash/backend-platform/enrichment-queue";
import type * as Security from "@stash/contracts-api/security";
import * as Link from "@stash/contracts-domain/link";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as LinksRepo from "../links-repo.ts";
import * as CanonicalizeUrl from "./canonicalize-url.ts";
import * as SaveRateLimiter from "./save-rate-limiter.ts";

/**
 * Stores the links without rate limiting and returns the stored link for each input, in order,
 * with whether this call created it (`created: false` for a link that was stored already). A
 * link whose canonical URL is already stored (or appears earlier in the same call) is not saved
 * again: the existing link is returned unchanged. Each newly stored link is enqueued for
 * enrichment. A save attributed to a device (its token, or an input `deviceId` from a caller
 * without one) also becomes that device's latest save.
 */
export const storeLinks = Effect.fn("storeLinks")(function* (
  principal: Security.Principal,
  inputs: ReadonlyArray<Link.SaveLinkInput>,
) {
  const repo = yield* LinksRepo.LinksRepo;
  const queue = yield* EnrichmentQueue.EnrichmentQueue;
  const createdAt = yield* DateTime.now;
  const newLinks = inputs.map((input): LinksRepo.NewLink => ({
    id: Link.LinkId.make(crypto.randomUUID()),
    url: input.url,
    canonicalUrl: CanonicalizeUrl.canonicalize(input.url),
    title: input.title ?? null,
    tags: [...new Set(input.tags ?? [])],
    // A device token decides the device. Otherwise (the web `/save` page) the input may name it.
    sourceDeviceId: principal.kind === "device" ? principal.deviceId : (input.deviceId ?? null),
    createdAt,
  }));
  const stored = yield* repo.insertAll(newLinks);
  const inserted = stored.filter((link, i) => isCreated(link, newLinks[i]));
  yield* queue.sendBatch(inserted.map((link) => ({ linkId: link.id })));
  return stored.map((link, i) => ({ link, created: isCreated(link, newLinks[i]) }));
});

/** `storeLinks` without `created`: the stored link for each input, in order. */
export const saveLinks = (
  principal: Security.Principal,
  inputs: ReadonlyArray<Link.SaveLinkInput>,
) => Effect.map(storeLinks(principal, inputs), (saved) => saved.map(({ link }) => link));

/** Whether `stored` is the link this call inserted, not one stored before (same canonical URL). */
const isCreated = (stored: Link.Link, inserted: LinksRepo.NewLink | undefined): boolean =>
  stored.id === inserted?.id;

/** Saves a batch (an import, or "save all" of a window). The whole batch counts as one save. */
export const saveLinksBatch = Effect.fn("saveLinksBatch")(function* (
  principal: Security.Principal,
  inputs: ReadonlyArray<Link.SaveLinkInput>,
) {
  const limiter = yield* SaveRateLimiter.SaveRateLimiter;
  yield* limiter.consume(principal);
  return yield* saveLinks(principal, inputs);
});
