import { describe, expect, it } from "@effect/vitest";
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
