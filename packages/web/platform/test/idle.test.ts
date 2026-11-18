import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import * as Idle from "../src/idle.ts";
import * as PageScroll from "../src/page-scroll.ts";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("whenIdle", () => {
  it("runs through requestIdleCallback, with the timeout, and cancels", () => {
    const asked: Array<{ run: () => void; timeout: number | undefined }> = [];
    const cancelled: Array<number> = [];
    vi.stubGlobal("window", {
      requestIdleCallback: (run: () => void, options?: { timeout?: number }) => {
        asked.push({ run, timeout: options?.timeout });
        return 7;
      },
      cancelIdleCallback: (id: number) => cancelled.push(id),
    });
    const run = vi.fn();
    const cancel = Idle.whenIdle(run, 500);
    expect(asked.map((one) => one.timeout)).toEqual([500]);
    expect(run).not.toHaveBeenCalled();
    asked[0]!.run();
    expect(run).toHaveBeenCalledTimes(1);
    cancel();
    expect(cancelled).toEqual([7]);
  });

  it("falls back to a short timer where the browser has no requestIdleCallback", () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { setTimeout, clearTimeout });
    const run = vi.fn();
    Idle.whenIdle(run);
    vi.advanceTimersByTime(Idle.fallbackMillis);
    expect(run).toHaveBeenCalledTimes(1);

    const never = vi.fn();
    Idle.whenIdle(never)();
    vi.advanceTimersByTime(Idle.fallbackMillis);
    expect(never).not.toHaveBeenCalled();
  });
});

describe("pageScrollTop", () => {
  it("reads the page's scroll position on each call", () => {
    const page = { scrollY: 0 };
    vi.stubGlobal("window", page);
    expect(PageScroll.pageScrollTop()).toBe(0);
    page.scrollY = 640;
    expect(PageScroll.pageScrollTop()).toBe(640);
  });
});
