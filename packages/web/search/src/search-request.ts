import type * as SearchGroup from "@stash/contracts-api/search";
import * as Device from "@stash/contracts-domain/device";
import * as Link from "@stash/contracts-domain/link";
import * as Tag from "@stash/contracts-domain/tag";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";

/** How far back a search looks. */
export type Range = "week" | "month" | "year";

/**
 * What a search is made of: the query and mode (with the device and date, they live in the URL,
 * see `search-route.ts`) and the type and tag the Inbox filters by. An empty `type`, `device`, `range` or `tag` means "any". */
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
