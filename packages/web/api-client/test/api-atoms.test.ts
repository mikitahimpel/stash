import { afterEach, beforeEach, describe, expect, it, vi } from "@effect/vitest";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as ApiAtoms from "../src/api-atoms.ts";
import * as Testing from "../src/testing.ts";
import * as Fixtures from "./fixtures.ts";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("ApiAtoms.query", () => {
  it("keeps its result after the last reader leaves and revalidates in the background", async () => {
    let requests = 0;
    const reg = Testing.makeRegistry({
      "GET /links/:id": () => {
        requests++;
        return Testing.json({ ...Fixtures.link("a"), title: `v${requests}` });
      },
    });
    const link = ApiAtoms.query(["links"], (client) =>
      client.links.get({ params: { id: "a" as never } }),
    );

    // First visit: nothing cached, one request.
    const leave = reg.mount(link);
    await expect.poll(() => AsyncResult.isSuccess(reg.get(link))).toBe(true);
    expect(requests).toBe(1);
    leave();
    await tick();

    // Second visit: the cached value shows at once, and a refresh runs behind it.
    const seen: Array<AsyncResult.AsyncResult<unknown, unknown>> = [];
    const stop = reg.subscribe(link, (result) => seen.push(result), { immediate: true });
    expect(AsyncResult.isSuccess(seen[0]!)).toBe(true);
    await expect.poll(() => requests).toBe(2);
    await expect
      .poll(() => {
        const result = reg.get(link);
        return AsyncResult.isSuccess(result) && !result.waiting ? result.value.title : undefined;
      })
      .toBe("v2");
    expect(seen.every(AsyncResult.isSuccess)).toBe(true);
    stop();
    reg.dispose();
  });
});

describe("ApiAtoms.prefetch", () => {
  const counted = () => {
    const count = { requests: 0 };
    const reg = Testing.makeRegistry({
      "GET /links/:id": () => {
        count.requests++;
        return Testing.json({ ...Fixtures.link("a"), title: `v${count.requests}` });
      },
    });
    const link = ApiAtoms.query(["links"], (client) =>
      client.links.get({ params: { id: "a" as never } }),
    );
    const settled = () => {
      const result = reg.get(link);
      return AsyncResult.isSuccess(result) && !result.waiting ? result.value.title : undefined;
    };
    return { count, reg, link, settled };
  };
  // Only the clock the freshness reads is faked; the timers stay real.
  const later = (millis: number) => vi.setSystemTime(Date.now() + millis);
  beforeEach(() => vi.useFakeTimers({ toFake: ["Date"] }));
  afterEach(() => vi.useRealTimers());

  it("loads a query before its page, which then shows it without a second request", async () => {
    const { count, reg, link, settled } = counted();

    const release = ApiAtoms.prefetch(reg, [link]);
    await expect.poll(settled).toBe("v1");

    // The page opens while the prefetch still holds the query: the result is there at once.
    const seen: Array<AsyncResult.AsyncResult<unknown, unknown>> = [];
    const stop = reg.subscribe(link, (result) => seen.push(result), { immediate: true });
    expect(AsyncResult.isSuccess(seen[0]!)).toBe(true);
    release();
    await tick();
    await tick();
    expect(count.requests).toBe(1);
    expect(seen.every((result) => AsyncResult.isSuccess(result) && !result.waiting)).toBe(true);
    stop();
    reg.dispose();
  });

  it("refreshes a cached query nothing reads, as a page that opens it would", async () => {
    const { count, reg, link, settled } = counted();
    const leave = reg.mount(link);
    await expect.poll(settled).toBe("v1");
    leave();
    await tick();

    const release = ApiAtoms.prefetch(reg, [link]);
    await expect.poll(settled).toBe("v2");
    expect(count.requests).toBe(2);
    release();
    release();
    reg.dispose();
  });

  it("asks again while it still holds the query, once the answer is old", async () => {
    const { count, reg, link, settled } = counted();
    ApiAtoms.prefetch(reg, [link]);
    await expect.poll(settled).toBe("v1");

    // Right away (the pointer is still on the tab): the answer is fresh, nothing is asked.
    later(ApiAtoms.prefetchFreshMillis - 100);
    ApiAtoms.prefetch(reg, [link]);
    await tick();
    expect(count.requests).toBe(1);

    // Later, but before the hold ends: the query is still read, and it is asked again.
    later(200);
    expect(ApiAtoms.prefetchFreshMillis + 100).toBeLessThan(ApiAtoms.prefetchHoldMillis);
    const release = ApiAtoms.prefetch(reg, [link]);
    await expect.poll(settled).toBe("v2");
    expect(count.requests).toBe(2);
    release();
    reg.dispose();
  });

  it("asks again for a query a page reads, once the answer is old", async () => {
    const { count, reg, link, settled } = counted();
    // The page is open and stays open.
    const leave = reg.mount(link);
    await expect.poll(settled).toBe("v1");

    ApiAtoms.prefetch(reg, [link]);
    await tick();
    expect(count.requests).toBe(1);

    later(ApiAtoms.prefetchFreshMillis);
    const release = ApiAtoms.prefetch(reg, [link]);
    await expect.poll(settled).toBe("v2");
    expect(count.requests).toBe(2);
    release();
    leave();
    reg.dispose();
  });

  it("keeps one hold per query: the first release lets go of it", async () => {
    const { count, reg, link, settled } = counted();
    const first = ApiAtoms.prefetch(reg, [link]);
    ApiAtoms.prefetch(reg, [link]);
    ApiAtoms.prefetch(reg, [link]);
    await expect.poll(settled).toBe("v1");
    first();
    await tick();

    // Nothing reads the query any more, so a page that opens it refreshes it.
    const leave = reg.mount(link);
    await expect.poll(settled).toBe("v2");
    expect(count.requests).toBe(2);
    leave();
    reg.dispose();
  });
});
