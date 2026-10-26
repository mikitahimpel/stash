import type * as Security from "@stash/contracts-api/security";
import type * as Link from "@stash/contracts-domain/link";
import * as Effect from "effect/Effect";
import * as SaveLinksBatch from "./save-links-batch.ts";
import * as SaveRateLimiter from "./save-rate-limiter.ts";

/**
 * Saves one link and answers right away: enrichment runs later from the queue. Saving a URL whose
 * canonical form is already stored returns the existing link and enqueues nothing.
 */
export const saveLink = Effect.fn("saveLink")(function* (
  principal: Security.Principal,
  input: Link.SaveLinkInput,
) {
  const limiter = yield* SaveRateLimiter.SaveRateLimiter;
  yield* limiter.consume(principal);
  const [stored] = yield* SaveLinksBatch.saveLinks(principal, [input]);
  return stored === undefined ? yield* Effect.die(new Error("saveLinks returned no link")) : stored;
});
