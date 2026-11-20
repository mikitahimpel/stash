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
// The screenshots show every view with day groups (the Inbox's) on the fixtures and this clock
// too. The views without them (Settings, the search results, the header, the invite, the login)
// read the real api, which dates its data by its own clock, so they keep the wall clock, as do
// `sign-in-walk.ts` and `live-session-check.ts`.
// `test/check-clock.test.ts` checks that every browser check uses this clock, and that the
// Inbox's day groups come from `now()`, which the wall clock doesn't move.
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
