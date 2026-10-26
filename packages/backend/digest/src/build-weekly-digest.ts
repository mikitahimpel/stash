import * as LinksRepo from "@stash/backend-links/links-repo";
import type * as Digest from "@stash/contracts-domain/digest";
import type * as Link from "@stash/contracts-domain/link";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as DigestsRepo from "./digests-repo.ts";

// The links are read page by page through `LinksRepo`, which owns the links tables, newest first
// until the period starts. A week holds few enough links to group them in memory.

export const periodDays = 7;
export const topTagsLimit = 10;
export const highlightsLimit = 5;
const pageSize = 100;

/**
 * The period that ends at the start of the current UTC day and spans `periodDays` days, so every
 * run on the same day builds (and replaces) the same digest.
 */
export const currentPeriod = Effect.map(DateTime.now, (now) => {
  const end = DateTime.startOf(now, "day");
  return { start: DateTime.subtract(end, { days: periodDays }), end };
});

/** The links created in `[start, end)`, newest first. */
const linksCreatedIn = Effect.fn("linksCreatedIn")(function* (
  start: DateTime.Utc,
  end: DateTime.Utc,
) {
  const repo = yield* LinksRepo.LinksRepo;
  const links: Array<Link.Link> = [];
  let after: LinksRepo.ListPosition | undefined;
  while (true) {
    const page = yield* repo.list(
      after === undefined ? { limit: pageSize } : { after, limit: pageSize },
    );
    for (const { link } of page) {
      if (DateTime.isLessThan(link.createdAt, start)) return links;
      if (DateTime.isLessThan(link.createdAt, end)) links.push(link);
    }
    const last = page.at(-1);
    if (last === undefined || page.length < pageSize) return links;
    after = last.position;
  }
});

/** Counts per key, most first, then by key. */
const countBy = <K extends string>(keys: ReadonlyArray<K>): Array<{ key: K; count: number }> => {
  const counts = new Map<K, number>();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  return [...counts]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
};

/** Unread links first, then enriched ones (with a summary), then the newest. */
const highlightRank = (link: Link.Link) =>
  (link.status === "new" ? 0 : 2) + (link.summary === null ? 1 : 0);

/** Groups the links of one period into a digest. Pure, so it is tested without a database. */
export const summarize = (
  links: ReadonlyArray<Link.Link>,
  period: { readonly start: DateTime.Utc; readonly end: DateTime.Utc },
  generatedAt: DateTime.Utc,
): Digest.Digest => {
  const byStatus = (status: Link.LinkStatus) =>
    links.filter((link) => link.status === status).length;
  return {
    periodStart: period.start,
    periodEnd: period.end,
    generatedAt,
    totals: {
      saved: links.length,
      seen: byStatus("seen"),
      done: byStatus("done"),
      archived: byStatus("archived"),
    },
    topTags: countBy(links.flatMap((link) => link.tags))
      .slice(0, topTagsLimit)
      .map(({ key, count }) => ({ name: key, count })),
    topTypes: countBy(links.flatMap((link) => (link.type === null ? [] : [link.type]))).map(
      ({ key, count }) => ({ type: key, count }),
    ),
    // `links` is newest first and the sort is stable, so ties stay newest first.
    highlights: links
      .filter((link) => link.status !== "archived")
      .toSorted((a, b) => highlightRank(a) - highlightRank(b))
      .slice(0, highlightsLimit)
      .map((link) => ({
        linkId: link.id,
        url: link.url,
        title: link.title,
        summary: link.summary,
      })),
  };
};

/** Builds the digest of the links saved in the last `periodDays` days and stores it. */
export const buildWeeklyDigest = Effect.fn("buildWeeklyDigest")(function* () {
  const period = yield* currentPeriod;
  const links = yield* linksCreatedIn(period.start, period.end);
  const digest = summarize(links, period, yield* DateTime.now);
  const repo = yield* DigestsRepo.DigestsRepo;
  yield* repo.save(digest);
  return digest;
});
