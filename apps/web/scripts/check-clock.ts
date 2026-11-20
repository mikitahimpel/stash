// The clock of the browser checks (#188): the layout audit, the Connect walk, the tab switch, the
// loading states, the live updates and the screenshots' synthetic pages. The Inbox groups links by
// day ("Today", "Yesterday", …), so with the wall clock a run in the early morning got another
// group header, which pushed rows and failed box and shift comparisons. Each check now runs at the
// same instant: its browser contexts start at `start` in `timezoneId` (`newContext`), and its
// synthetic api is dated by `now()`, so the pages look the same at every hour and in every time
// zone of the machine.
//
// Time still passes from there in step with real time (Playwright's `clock.setSystemTime`, no
// fake timers), so what the app measures with `Date` (a skeleton's minimum time, how fresh an
// answer is) works as it does for a user. `now()` counts that time on the monotonic clock, so the
// wall clock never enters it.
//
// What a real api answers is dated by the api's own clock, so `sign-in-walk.ts`,
// `live-session-check.ts` and the screenshots of the seeded api's pages keep the wall clock.
// `test/check-clock.test.ts` checks that every browser check uses this clock, and that the Inbox's
// day groups at the checks' clock are the same with the machine's clock at 03:30 as at midday.
import type { Browser, BrowserContext, BrowserContextOptions } from "playwright";

/** Wednesday 17 June 2026, 12:00: midday, mid-week, mid-month, far from any edge of a day. */
export const start = Date.UTC(2026, 5, 17, 12, 0, 0);

/** The time zone of every check's browser, whatever the machine's is. */
export const timezoneId = "UTC";

const startedAt = performance.now();

/** Now on the checks' clock: `start`, plus the real time since the check started. */
export const now = (): number => start + Math.round(performance.now() - startedAt);

/** A browser context whose pages run on the checks' clock, in `timezoneId`. */
export const newContext = async (
  browser: Browser,
  options: BrowserContextOptions = {},
): Promise<BrowserContext> => {
  const context = await browser.newContext({ ...options, timezoneId });
  await context.clock.setSystemTime(now());
  return context;
};
