/** How many months the timeline spans, ending with the current one. */
export const monthCount = 12;

// Number labels closer than this (a fraction of the width) go on separate lanes.
const labelGap = 0.035;
const laneCount = 3;

const monthNames = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export interface Month {
  readonly label: string;
  /** Where the month starts, from 0 (left edge) to 1 (right edge). */
  readonly x: number;
}

export interface Match {
  readonly id: string;
  /** 1 for the best match. */
  readonly rank: number;
  readonly x: number;
  /** Which row its number sits on, so close numbers don't overlap. 0 is nearest the axis. */
  readonly lane: number;
}

export interface Layout {
  readonly months: ReadonlyArray<Month>;
  /** Every other saved link, as a neutral dot. */
  readonly dots: ReadonlyArray<number>;
  readonly matches: ReadonlyArray<Match>;
  /** Matches saved before the timeline starts, which it can't show. */
  readonly older: number;
}

/** A link on the timeline: its id and when it was saved (epoch millis). */
export interface Point {
  readonly id: string;
  readonly createdAt: number;
}

const monthStart = (year: number, month: number): number => Date.UTC(year, month, 1);

/**
 * Places the last twelve months (UTC) up to `now` on a line. `matches` come in rank order and are
 * numbered from 1. `saved` are the links behind them; those that are also matches are left out.
 * Links outside the twelve months are not drawn.
 */
export const layout = (input: {
  readonly now: number;
  readonly matches: ReadonlyArray<Point>;
  readonly saved: ReadonlyArray<Point>;
}): Layout => {
  const today = new Date(input.now);
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth();
  const start = monthStart(year, month - (monthCount - 1));
  const end = monthStart(year, month + 1);
  const position = (time: number) => (time - start) / (end - start);
  const inRange = (time: number) => time >= start && time < end;

  const months = Array.from({ length: monthCount }, (_, i) => {
    const first = new Date(monthStart(year, month - (monthCount - 1) + i));
    return { label: monthNames[first.getUTCMonth()] ?? "", x: position(first.getTime()) };
  });

  const matchIds = new Set(input.matches.map((point) => point.id));
  const dots = input.saved
    .filter((point) => !matchIds.has(point.id) && inRange(point.createdAt))
    .map((point) => position(point.createdAt));

  // Each lane remembers where its last number sits; a number takes the lowest lane that is clear,
  // or the first lane when none is.
  const ranked = input.matches.map((point, i) => ({ ...point, rank: i + 1 }));
  const shown = ranked
    .filter((point) => inRange(point.createdAt))
    .map((point) => ({ id: point.id, rank: point.rank, x: position(point.createdAt) }));
  const lanes: Array<Array<number>> = Array.from({ length: laneCount }, () => []);
  const matches = shown.map((point): Match => {
    const free = lanes.findIndex((taken) => taken.every((x) => Math.abs(x - point.x) >= labelGap));
    const lane = free === -1 ? 0 : free;
    lanes[lane]?.push(point.x);
    return { ...point, lane };
  });

  return { months, dots, matches, older: ranked.length - shown.length };
};

/** What the timeline shows, in words, for its `aria-label`. */
export const describe = (result: Layout): string => {
  const first = result.months[0]?.label ?? "";
  const last = result.months.at(-1)?.label ?? "";
  const count = result.matches.length;
  const matches = `${count} ${count === 1 ? "match" : "matches"}`;
  const older = result.older > 0 ? `, ${result.older} older` : "";
  return `${matches}${older} among ${result.dots.length + count} saved links, ${first} to ${last}`;
};
