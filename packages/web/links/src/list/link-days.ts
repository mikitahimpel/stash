import type * as Link from "@stash/contracts-domain/link";
import * as DateTime from "effect/DateTime";

/** The calendar day of `date` in `zone`, as `YYYY-MM-DD`. */
export const dayKey = (date: DateTime.DateTime, zone: DateTime.TimeZone): string =>
  DateTime.formatIsoDate(DateTime.setZone(date, zone));

/** The keys of the `count` days that end with today, oldest first. */
export const lastDays = (now: DateTime.Utc, zone: DateTime.TimeZone, count: number) => {
  const today = DateTime.setZone(now, zone);
  return Array.from({ length: count }, (_, i) =>
    DateTime.formatIsoDate(DateTime.subtract(today, { days: count - 1 - i })),
  );
};

/** The links saved on one day. */
export interface DayGroup {
  readonly key: string;
  /** `Today`, `Yesterday`, or the date (`Mon, Oct 20`, with the year when it isn't this one). */
  readonly label: string;
  readonly links: ReadonlyArray<Link.Link>;
}

const label = (date: DateTime.DateTime, now: DateTime.Utc, zone: DateTime.TimeZone): string => {
  const [yesterday = "", today = ""] = lastDays(now, zone, 2);
  const key = dayKey(date, zone);
  if (key === today) return "Today";
  if (key === yesterday) return "Yesterday";
  const zoned = DateTime.setZone(date, zone);
  return DateTime.format(zoned, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(key.slice(0, 4) === today.slice(0, 4) ? {} : { year: "numeric" }),
    locale: "en",
  });
};

/** Groups newest-first links by the day they were saved, in `zone`. Keeps the order. */
export const groupByDay = (
  links: ReadonlyArray<Link.Link>,
  now: DateTime.Utc,
  zone: DateTime.TimeZone,
): ReadonlyArray<DayGroup> => {
  const groups: Array<{ key: string; label: string; links: Array<Link.Link> }> = [];
  for (const link of links) {
    const key = dayKey(link.createdAt, zone);
    const last = groups.at(-1);
    if (last?.key === key) last.links.push(link);
    else groups.push({ key, label: label(link.createdAt, now, zone), links: [link] });
  }
  return groups;
};
