import type * as SearchGroup from "@stash/contracts-api/search";
import * as Device from "@stash/contracts-domain/device";
import * as Link from "@stash/contracts-domain/link";
import * as Tag from "@stash/contracts-domain/tag";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";

/** How far back a search looks. */
export type Range = "week" | "month" | "year";

/** What the search form holds. An empty `type`, `device`, `range` or `tag` means "any". */
export interface Form {
  readonly q: string;
  readonly mode: SearchGroup.SearchMode;
  readonly type: Link.LinkType | "";
  /** The id of the device the links were saved from. */
  readonly device: string;
  readonly range: Range | "";
  /** Set by a tag clicked on a row. */
  readonly tag: string;
}

export const emptyForm: Form = { q: "", mode: "hybrid", type: "", device: "", range: "", tag: "" };

export const modes: ReadonlyArray<{
  readonly value: SearchGroup.SearchMode;
  readonly label: string;
}> = [
  { value: "hybrid", label: "Hybrid" },
  { value: "semantic", label: "Meaning" },
  { value: "keyword", label: "Keywords" },
];

/** Whether the mode matches words, so the results highlight the query's terms. */
export const matchesWords = (mode: SearchGroup.SearchMode): boolean => mode !== "semantic";

export const types: ReadonlyArray<Link.LinkType> = Link.LinkType.literals;

export const typeLabels: Readonly<Record<Link.LinkType, string>> = {
  article: "Article",
  video: "Video",
  tool: "Tool",
  repo: "Repo",
  other: "Other",
};

export const ranges: ReadonlyArray<{ readonly value: Range; readonly label: string }> = [
  { value: "week", label: "Past week" },
  { value: "month", label: "Past month" },
  { value: "year", label: "Past year" },
];

const rangeDays: Readonly<Record<Range, number>> = { week: 7, month: 30, year: 365 };

const hour = 60 * 60 * 1000;

/**
 * The moment a range starts at, counted back from the start of the current hour: the same range
 * asked twice within an hour is the same request, so its results come from the cache.
 */
export const since = (range: Range, now: DateTime.Utc): DateTime.Utc =>
  DateTime.subtract(DateTime.makeUnsafe(Math.floor(DateTime.toEpochMillis(now) / hour) * hour), {
    days: rangeDays[range],
  });

const maxQueryLength = 500;
const isTagName = Schema.is(Tag.TagName);
const isLinkType = Schema.is(Link.LinkType);
const isDeviceId = Schema.is(Device.DeviceId);
const isRange = (value: string): value is Range => value in rangeDays;

/** The filters of `form` that are set and valid, as the api takes them. */
export const filters = (
  form: Form,
  now: DateTime.Utc,
): Pick<SearchGroup.SearchQuery, "type" | "tag" | "deviceId" | "since"> => {
  const tag = form.tag.trim().toLowerCase();
  return {
    ...(isLinkType(form.type) ? { type: form.type } : {}),
    ...(isTagName(tag) ? { tag } : {}),
    ...(isDeviceId(form.device) ? { deviceId: form.device } : {}),
    ...(isRange(form.range) ? { since: since(form.range, now) } : {}),
  };
};

/**
 * The query parameters of `GET /search` for `form`, or `undefined` when there is nothing to search
 * for (a blank query). The query is trimmed and cut to the contract's maximum length, the tag is
 * trimmed and lowercased, and filters that are empty or invalid are left out.
 */
export const fromForm = (form: Form, now: DateTime.Utc): SearchGroup.SearchQuery | undefined => {
  const q = form.q.trim().slice(0, maxQueryLength);
  if (q === "") return undefined;
  return { q, mode: form.mode, ...filters(form, now) };
};

/** Whether `link` passes the form's filters: what the api does for a search, done here for a list. */
export const passes = (form: Form, now: DateTime.Utc, link: Link.Link): boolean => {
  const wanted = filters(form, now);
  return (
    (wanted.type === undefined || link.type === wanted.type) &&
    (wanted.tag === undefined || link.tags.includes(wanted.tag)) &&
    (wanted.deviceId === undefined || link.sourceDeviceId === wanted.deviceId) &&
    (wanted.since === undefined ||
      DateTime.toEpochMillis(link.createdAt) >= DateTime.toEpochMillis(wanted.since))
  );
};

const minute = 60_000;
const day = 24 * hour;

/** How long ago `then` (epoch milliseconds) was, short: `now`, `12m`, `5h`, `3d`, `2w`, `4mo`, `1y`. */
export const age = (then: number, now: number): string => {
  const ms = Math.max(0, now - then);
  return ms < minute
    ? "now"
    : ms < hour
      ? `${Math.floor(ms / minute)}m`
      : ms < day
        ? `${Math.floor(ms / hour)}h`
        : ms < 14 * day
          ? `${Math.floor(ms / day)}d`
          : ms < 60 * day
            ? `${Math.floor(ms / (7 * day))}w`
            : ms < 365 * day
              ? `${Math.floor(ms / (30 * day))}mo`
              : `${Math.floor(ms / (365 * day))}y`;
};

/** The host a link points to, without `www.`. Prefers the canonical URL. */
export const host = (link: Link.Link): string =>
  new URL(link.canonicalUrl ?? link.url).hostname.replace(/^www\./, "");

/** How many tags a row shows before `+n`. */
export const maxRowTags = 3;
