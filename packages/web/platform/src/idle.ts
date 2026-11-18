/** How long the fallback waits where the browser has no `requestIdleCallback` (Safari). */
export const fallbackMillis = 200;

/**
 * Runs `run` once the page has nothing more urgent to do (`requestIdleCallback`), and after
 * `timeoutMillis` at the latest. Returns the function that cancels it.
 */
export const whenIdle = (run: () => void, timeoutMillis = 2000): (() => void) => {
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(() => run(), { timeout: timeoutMillis });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(run, fallbackMillis);
  return () => window.clearTimeout(id);
};
