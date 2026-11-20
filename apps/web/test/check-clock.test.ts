// The browser checks run on their own clock, not the wall clock (#188): see `scripts/check-clock.ts`.
import * as Fs from "node:fs";
import * as Path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { minutesIn, zoneAt } from "../scripts/at-wall-clock.ts";
import * as CheckClock from "../scripts/check-clock.ts";
import * as Fixtures from "../scripts/layout-fixtures.ts";

const scripts = Path.resolve(import.meta.dirname, "../scripts");
const read = (name: string) => Fs.readFileSync(Path.join(scripts, name), "utf8");

/** Against a real api, whose own clock dates the data. */
const onTheWallClock = ["screenshots.ts", "sign-in-walk.ts", "live-session-check.ts"];
/** Draws icons: no page of the app, nothing dated. */
const noApp = ["brand-icons.ts"];

const browserScripts = Fs.readdirSync(scripts).filter(
  (name) => name.endsWith(".ts") && read(name).includes("chromium.launch("),
);

describe("the browser checks' clock", () => {
  it("knows every script that opens a browser", () => {
    expect(browserScripts).toEqual(
      expect.arrayContaining(["layout-audit.ts", "loading-states.ts", "live-updates.ts"]),
    );
  });

  for (const name of browserScripts.filter((n) => ![...onTheWallClock, ...noApp].includes(n))) {
    it(`${name} runs its pages and its fixtures on the checks' clock`, () => {
      const source = read(name);
      expect(source).toContain("CheckClock.newContext(browser");
      expect(source).not.toMatch(/browser\.newContext\(|browser\.newPage\(/);
      // The fixtures and the localStorage seed are dated by the checks' clock.
      expect(source).not.toMatch(/Fixtures\.\w+\(Date\.now\(\)/);
      expect(source).not.toMatch(/const now = Date\.now\(\)/);
    });
  }

  it("starts at midday in its own time zone, far from either end of the day", () => {
    expect(CheckClock.timezoneId).toBe("UTC");
    expect(minutesIn(CheckClock.timezoneId, CheckClock.start)).toBe(12 * 60);
    expect(new Date(CheckClock.start).getUTCDay()).toBe(3);
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
    for (const time of ["2026-11-20T00:30:00", "2026-11-20T23:30:00", "2027-03-01T04:00:00"]) {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(time));
      expect(answers()).toEqual(midday);
      vi.useRealTimers();
    }
  });
});

describe("at-wall-clock", () => {
  const hours = [0, 5, 11, 17, 23].map((h) => Date.UTC(2026, 10, 20, h, 17));
  for (const target of ["00:30", "23:30"]) {
    it(`finds a zone where the clock reads ${target}, give or take 30 minutes`, () => {
      const wanted = Number(target.slice(0, 2)) * 60 + Number(target.slice(3));
      for (const instant of hours) {
        const off = Math.abs(minutesIn(zoneAt(target, instant), instant) - wanted);
        expect(Math.min(off, 24 * 60 - off)).toBeLessThanOrEqual(30);
      }
    });
  }

  it("refuses a time that isn't HH:MM", () => {
    expect(() => zoneAt("7pm", 0)).toThrow("HH:MM");
  });
});
