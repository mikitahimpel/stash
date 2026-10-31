import * as LinksGroup from "@stash/contracts-api/links";
import type * as Link from "@stash/contracts-domain/link";
import * as ApiAtoms from "@stash/web-api-client/api-atoms";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as LinkDays from "./link-days.ts";

/** The chart covers this many days, today included. */
export const days = 30;

/** One bar: the links saved that day. `read` are `seen` or `done`, `unread` still `new`. */
export interface Day {
  readonly key: string;
  readonly saved: number;
  readonly read: number;
  readonly unread: number;
}

export interface History {
  /** Oldest first, one per day, ending with today. */
  readonly days: ReadonlyArray<Day>;
  readonly saved: number;
  readonly read: number;
  readonly unread: number;
}

const isRead = (status: Link.LinkStatus) => status === "seen" || status === "done";

/** The history in one line, for the chart's label. */
export const summary = (history: History): string =>
  `${history.saved} saved · ${history.read} read · ${history.unread} unread · last ${days} days`;

/** The history in short, for the page subtitle. */
export const headline = (history: History): string =>
  `${history.unread} unread · ${history.saved} saved in ${days} days`;

/** Below this many days with a bar the chart shows no trend, so it stays off the page. */
export const minDays = 3;

/** Whether there is enough to plot. */
export const plottable = (history: History): boolean =>
  history.days.filter((day) => day.saved > 0).length >= minDays;

/** Counts the links saved in the last `days` days, per day and in total. Archived links count as saved only. */
export const history = (
  links: ReadonlyArray<Link.Link>,
  now: DateTime.Utc,
  zone: DateTime.TimeZone,
): History => {
  const counts = new Map(
    LinkDays.lastDays(now, zone, days).map((key) => [key, { key, saved: 0, read: 0, unread: 0 }]),
  );
  for (const link of links) {
    const day = counts.get(LinkDays.dayKey(link.createdAt, zone));
    if (day === undefined) continue;
    day.saved += 1;
    if (isRead(link.status)) day.read += 1;
    if (link.status === "new") day.unread += 1;
  }
  const all = [...counts.values()];
  const total = (field: "saved" | "read" | "unread") =>
    all.reduce((sum, day) => sum + day[field], 0);
  return { days: all, saved: total("saved"), read: total("read"), unread: total("unread") };
};

/** Pages are capped, so a burst of saves can't turn the chart into hundreds of requests. */
export const maxPages = 20;

/**
 * The links saved since `since`, newest first: pages of `GET /links` until one reaches past
 * `since`, or `maxPages` of them.
 */
export const savedSince = (client: ApiAtoms.Client, since: DateTime.Utc, pageSize: number) =>
  Effect.gen(function* () {
    const links: Array<Link.Link> = [];
    let cursor: string | undefined;
    for (let page = 0; page < maxPages; page++) {
      const query: LinksGroup.ListLinksQuery = {
        sort: "recent",
        limit: pageSize,
        ...(cursor === undefined ? {} : { cursor }),
      };
      const result = yield* client.links.list({ query });
      links.push(...result.items.filter((link) => !DateTime.isLessThan(link.createdAt, since)));
      const last = result.items.at(-1);
      if (result.nextCursor === null || last === undefined) break;
      if (DateTime.isLessThan(last.createdAt, since)) break;
      cursor = result.nextCursor;
    }
    return links as ReadonlyArray<Link.Link>;
  });

/**
 * The links of the chart and the time they were loaded at. It loads again whenever a links
 * mutation succeeds, so marking a link seen moves it to `read`.
 */
export const recent = ApiAtoms.query(["links"], (client) =>
  Effect.gen(function* () {
    const now = yield* DateTime.now;
    // One extra day covers time zones ahead of UTC; `history` keeps only the chart's days.
    const links = yield* savedSince(
      client,
      DateTime.subtract(now, { days: days + 1 }),
      LinksGroup.maxPageSize,
    );
    return { links, now };
  }),
);
