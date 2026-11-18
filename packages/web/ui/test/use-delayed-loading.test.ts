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
  it("never turns on for a load faster than 150 ms", async () => {
    const { scope, loading, shown } = setup(true);
    vi.advanceTimersByTime(149);
    expect(shown.value).toBe(false);
    loading.value = false;
    await nextTick();
    vi.advanceTimersByTime(1000);
    expect(shown.value).toBe(false);
    scope.stop();
  });

  it("holds nothing back when the skeleton was never shown", async () => {
    const { scope, loading, shown } = setup(true);
    // The answer comes just before the skeleton would show: the minimum doesn't apply.
    vi.advanceTimersByTime(140);
    loading.value = false;
    await nextTick();
    expect(shown.value).toBe(false);
    vi.advanceTimersByTime(10);
    expect(shown.value).toBe(false);
    vi.advanceTimersByTime(300);
    expect(shown.value).toBe(false);
    scope.stop();
  });

  it("turns on after 150 ms of loading and stays for at least 300 ms", async () => {
    const { scope, loading, shown } = setup(true);
    vi.advanceTimersByTime(150);
    expect(shown.value).toBe(true);
    // The answer comes 50 ms after the skeleton: it stays for the other 250.
    vi.advanceTimersByTime(50);
    loading.value = false;
    await nextTick();
    expect(shown.value).toBe(true);
    vi.advanceTimersByTime(249);
    expect(shown.value).toBe(true);
    vi.advanceTimersByTime(1);
    expect(shown.value).toBe(false);
    scope.stop();
  });

  it("turns off at once when the load ends after the minimum", async () => {
    const { scope, loading, shown } = setup(true);
    vi.advanceTimersByTime(150 + 300);
    expect(shown.value).toBe(true);
    loading.value = false;
    await nextTick();
    expect(shown.value).toBe(false);
    scope.stop();
  });

  it("stays on when a new load starts while it is held", async () => {
    const { scope, loading, shown } = setup(true);
    vi.advanceTimersByTime(200);
    loading.value = false;
    await nextTick();
    loading.value = true;
    await nextTick();
    vi.advanceTimersByTime(1000);
    expect(shown.value).toBe(true);
    scope.stop();
  });

  it("stays off when nothing loads", () => {
    const { scope, shown } = setup(false);
    vi.advanceTimersByTime(1000);
    expect(shown.value).toBe(false);
    scope.stop();
  });
});
