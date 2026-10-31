/** The most months the timeline spans, ending with the current one. */
export const monthCount = 12;

/** The fewest days it spans, so a fresh stash still has room between its dots. */
export const minDays = 30;

// Data newer than this many days gets a day axis with weekly ticks; older data, a month axis.
const dayAxisMaxDays = 92;
const day = 24 * 60 * 60 * 1000;

// Number labels closer than this (a fraction of the width, ~18px on a phone) go on separate lanes.
const labelGap = 0.05;
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

export interface Tick {
  /** `Oct` on a month axis, `Oct 5` on a day axis. */
  readonly label: string;
  /** Where the month or week starts, from 0 (left edge) to 1 (right edge). */
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
  readonly ticks: ReadonlyArray<Tick>;
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

const dayStart = (time: number): number => Math.floor(time / day) * day;

// The axis fits the data: from the oldest link shown (at most twelve months back, at least
// `minDays`) to now. Weeks start on Monday (UTC).
const axis = (now: number, times: ReadonlyArray<number>) => {
  const today = new Date(now);
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth();
  const earliest = Math.min(
    now,
    ...times.filter((time) => time >= monthStart(year, month - (monthCount - 1)) && time <= now),
  );
  if (earliest < now - dayAxisMaxDays * day) {
    const first = new Date(earliest);
    const offset = (first.getUTCFullYear() - year) * 12 + first.getUTCMonth() - month;
    const start = monthStart(year, month + offset);
    const end = monthStart(year, month + 1);
    const ticks = Array.from({ length: 1 - offset }, (_, i) => {
      const time = monthStart(year, month + offset + i);
      return { time, label: monthNames[new Date(time).getUTCMonth()] ?? "" };
    });
    return { start, end, ticks };
  }
  const start = dayStart(Math.min(earliest, now - (minDays - 1) * day));
  const end = dayStart(now) + day;
  // 1970-01-01 was a Thursday, so Mondays are 4 days after a multiple of 7 days.
  const monday = (time: number) => Math.ceil((time - 4 * day) / (7 * day)) * 7 * day + 4 * day;
  const ticks: Array<{ time: number; label: string }> = [];
  for (let time = monday(start); time < end; time += 7 * day) {
    const date = new Date(time);
    ticks.push({ time, label: `${monthNames[date.getUTCMonth()]} ${date.getUTCDate()}` });
  }
  return { start, end, ticks };
};

/**
 * Places the matches and saved links on a time axis that ends now and starts with the oldest of
 * them, between `minDays` and twelve months (UTC) back. `matches` come in rank order and are
 * numbered from 1. `saved` are the links behind them; those that are also matches are left out.
 * Links older than twelve months are not drawn.
 */
export const layout = (input: {
  readonly now: number;
  readonly matches: ReadonlyArray<Point>;
  readonly saved: ReadonlyArray<Point>;
}): Layout => {
  const {
    start,
    end,
    ticks: times,
  } = axis(
    input.now,
    [...input.matches, ...input.saved].map((point) => point.createdAt),
  );
  const position = (time: number) => (time - start) / (end - start);
  const inRange = (time: number) => time >= start && time < end;
  const ticks = times.map((tick) => ({ label: tick.label, x: position(tick.time) }));

  const matchIds = new Set(input.matches.map((point) => point.id));
  const dots = input.saved
    .filter((point) => !matchIds.has(point.id) && inRange(point.createdAt))
    .map((point) => position(point.createdAt));

  // Each lane remembers where its numbers sit; a number takes the lowest lane that is clear, or,
  // when none is, the lane whose nearest number is farthest away.
  const ranked = input.matches.map((point, i) => ({ ...point, rank: i + 1 }));
  const shown = ranked
    .filter((point) => inRange(point.createdAt))
    .map((point) => ({ id: point.id, rank: point.rank, x: position(point.createdAt) }));
  const lanes: Array<Array<number>> = Array.from({ length: laneCount }, () => []);
  const matches = shown.map((point): Match => {
    const free = lanes.findIndex((taken) => taken.every((x) => Math.abs(x - point.x) >= labelGap));
    const room = (taken: ReadonlyArray<number>) =>
      Math.min(Infinity, ...taken.map((x) => Math.abs(x - point.x)));
    const lane =
      free !== -1
        ? free
        : lanes.reduce((best, taken, i) => (room(taken) > room(lanes[best] ?? []) ? i : best), 0);
    lanes[lane]?.push(point.x);
    return { ...point, lane };
  });

  return { ticks, dots, matches, older: ranked.length - shown.length };
};

/** What the timeline shows, in words, for its `aria-label`. */
export const describe = (result: Layout): string => {
  const first = result.ticks[0]?.label ?? "";
  const last = result.ticks.at(-1)?.label ?? "";
  const count = result.matches.length;
  const matches = `${count} ${count === 1 ? "match" : "matches"}`;
  const older = result.older > 0 ? `, ${result.older} older` : "";
  return `${matches}${older} among ${result.dots.length + count} saved links, ${first} to ${last}`;
};

/** Fewer links than this on the axis show no pattern, so the timeline stays off the page. */
export const minPoints = 3;

/** Whether there is something to plot: matches, and enough links with them. */
export const plottable = (matches: ReadonlyArray<Point>, saved: ReadonlyArray<Point>): boolean =>
  matches.length > 0 && new Set([...matches, ...saved].map((point) => point.id)).size >= minPoints;
