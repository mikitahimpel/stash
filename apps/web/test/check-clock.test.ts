// The browser checks run on their own clock, not the wall clock (#188): see `scripts/check-clock.ts`.
import * as Fs from "node:fs";
import * as Path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as CheckClock from "../scripts/check-clock.ts";
import * as Fixtures from "../scripts/layout-fixtures.ts";

const scripts = Path.resolve(import.meta.dirname, "../scripts");
const read = (name: string) => Fs.readFileSync(Path.join(scripts, name), "utf8");

/** Against a real api only, whose own clock dates the data. */
const onTheWallClock = ["sign-in-walk.ts", "live-session-check.ts"];
/** Draws icons: no page of the app, nothing dated. */
const noApp = ["brand-icons.ts"];

const browserScripts = Fs.readdirSync(scripts).filter(
  (name) => name.endsWith(".ts") && read(name).includes("chromium.launch("),
);

describe("the browser checks' clock", () => {
  it("knows every script that opens a browser", () => {
    expect(browserScripts).toEqual(
      expect.arrayContaining(["layout-audit.ts", "loading-states.ts", "screenshots.ts"]),
    );
  });

  for (const name of browserScripts.filter((n) => ![...onTheWallClock, ...noApp].includes(n))) {
    it(`${name} runs its synthetic pages and fixtures on the checks' clock`, () => {
      const source = read(name);
      expect(source).toContain("CheckClock.newContext(browser");
      // The fixtures are dated by the checks' clock.
      expect(source).not.toMatch(/Fixtures\.(seeded|empty|connectable)\(Date\.now\(\)/);
      expect(source).not.toMatch(/const now = Date\.now\(\)/);
      // Only the screenshots open a context on the wall clock too, for the seeded api's pages.
      if (name !== "screenshots.ts") {
        expect(source).not.toMatch(/browser\.newContext\(|browser\.newPage\(/);
      }
    });
  }

  it("starts at midday in its own time zone, mid-week", () => {
    expect(CheckClock.timezoneId).toBe("UTC");
    expect(new Date(CheckClock.start).toISOString()).toBe("2026-06-17T12:00:00.000Z");
    expect(new Date(CheckClock.start).getUTCDay()).toBe(3);
  });
});

/**
 * The Inbox's day groups for the seeded links at `now`, in the browser's zone (UTC): each day's
 * `YYYY-MM-DD` with how many links it holds, newest first, as `@stash/web-links` groups them.
 */
const dayGroups = (now: number) => {
  const page = Fixtures.seeded(now).answer("GET", new URL("http://localhost/api/links")) as {
    readonly items: ReadonlyArray<{ readonly createdAt: string }>;
  };
  const groups: Array<[day: string, links: number]> = [];
  for (const link of page.items) {
    const day = link.createdAt.slice(0, 10);
    const last = groups.at(-1);
    if (last?.[0] === day) last[1]++;
    else groups.push([day, 1]);
  }
  return groups;
};

const today = (now: number) => new Date(now).toISOString().slice(0, 10);

describe("the Inbox's day groups on the checks' clock", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** The day groups a check sees when it starts with the machine's clock at `wallClock`. */
  const withWallClockAt = (wallClock: string) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(wallClock));
    const now = CheckClock.now();
    return { today: today(now), groups: dayGroups(now) };
  };

  it("are the same with the machine's clock at 03:30 as at midday", () => {
    const midday = withWallClockAt("2026-11-20T12:00:00Z");
    vi.useRealTimers();
    const early = withWallClockAt("2026-11-20T03:30:00Z");
    expect(early).toEqual(midday);
    // As the loading states' skeleton draws it: Today first, with two rows or more.
    expect(early.groups[0]?.[0]).toBe(early.today);
    expect(early.groups[0]?.[1]).toBeGreaterThanOrEqual(2);
  });

  it("would differ with the fixtures dated at 03:30, as they were on the wall clock", () => {
    const at0330 = Date.UTC(2026, 5, 17, 3, 30);
    const groups = dayGroups(at0330);
    expect(groups).not.toEqual(dayGroups(CheckClock.start));
    // One row of Today, then Yesterday: the second row moved down by a group header.
    expect(groups[0]).toEqual([today(at0330), 1]);
  });
});

describe("the fixtures", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const answers = () => {
    const seeded = Fixtures.seeded(CheckClock.start);
    const empty = Fixtures.empty(CheckClock.start);
    return ["/api/links", "/api/tabs", "/api/devices", "/api/members/me", "/api/tokens"].map(
      (path) => [
        seeded.answer("GET", new URL(`http://localhost${path}`)),
        empty.answer("GET", new URL(`http://localhost${path}`)),
      ],
    );
  };

  it("answer the same at every hour of the wall clock", () => {
    const midday = answers();
    for (const time of ["2026-11-20T00:30:00", "2026-11-20T03:30:00", "2026-11-20T23:30:00"]) {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(time));
      expect(answers()).toEqual(midday);
      vi.useRealTimers();
    }
  });
});
