import * as Canonicalize from "@stash/backend-links/canonicalize-url";
import * as LinksRepo from "@stash/backend-links/links-repo";
import type * as D1Database from "@stash/backend-platform/d1-database";
import type * as Security from "@stash/contracts-api/security";
import type * as Tab from "@stash/contracts-domain/tab";
import * as Effect from "effect/Effect";

/**
 * The tabs whose page is a stored link: each tab's url is canonicalized as a save would do it and
 * matched against `links.canonical_url`, so the answer is exact, however old the link is. One
 * query for every tab of every device, among the current user's links only.
 */
export const savedTabs = (
  tabs: ReadonlyArray<Tab.OpenTab>,
): Effect.Effect<
  ReadonlyArray<Tab.SavedTab>,
  D1Database.DatabaseError,
  LinksRepo.LinksRepo | Security.CurrentUser
> =>
  Effect.gen(function* () {
    if (tabs.length === 0) return [];
    const canonical = new Map(tabs.map((tab) => [tab.url, Canonicalize.canonicalize(tab.url)]));
    const repo = yield* LinksRepo.LinksRepo;
    const links = yield* repo.findByCanonicalUrls([...new Set(canonical.values())]);
    const byCanonical = new Map(links.map((link) => [link.canonicalUrl, link]));
    const saved: Array<Tab.SavedTab> = [];
    for (const [url, key] of canonical) {
      const link = byCanonical.get(key);
      if (link !== undefined) saved.push({ url, linkId: link.id, imageUrl: link.imageUrl });
    }
    return saved;
  }).pipe(Effect.withSpan("savedTabs"));
