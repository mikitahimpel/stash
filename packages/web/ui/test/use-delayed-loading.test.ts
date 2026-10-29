import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, ref } from "vue";
import { useDelayedLoading } from "../src/delayed-loading/use-delayed-loading.ts";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const setup = (initial: boolean) => {
  const scope = effectScope();
  const loading = ref(initial);
  const shown = scope.run(() => useDelayedLoading(loading))!;
  return { scope, loading, shown };
};

describe("useDelayedLoading", () => {
  it("never turns on for a load faster than 200 ms", async () => {
    const { scope, loading, shown } = setup(true);
    vi.advanceTimersByTime(199);
    expect(shown.value).toBe(false);
    loading.value = false;
    await nextTick();
    vi.advanceTimersByTime(1000);
    expect(shown.value).toBe(false);
    scope.stop();
  });

  it("turns on after 200 ms of loading and off once loaded", async () => {
    const { scope, loading, shown } = setup(true);
    vi.advanceTimersByTime(200);
    expect(shown.value).toBe(true);
    loading.value = false;
    await nextTick();
    expect(shown.value).toBe(false);
    scope.stop();
  });

  it("stays off when nothing loads", () => {
    const { scope, shown } = setup(false);
    vi.advanceTimersByTime(1000);
    expect(shown.value).toBe(false);
    scope.stop();
  });
});
