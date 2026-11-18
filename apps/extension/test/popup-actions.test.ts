import { describe, expect, it } from "@effect/vitest";
import * as Testing from "@stash/ext-platform/testing";
import * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as PopupActions from "../entrypoints/popup/popup-actions.ts";

// Wiring only: the popup's actions run on the platform services. Their behavior is tested in
// `@stash/ext-popup`.
describe("popup actions", () => {
  it("shows the page and offers to connect before the browser is paired", async () => {
    const runtime = ManagedRuntime.make(
      Testing.make({
        tabs: [Testing.tab({ id: 1, url: "https://example.com/a", title: "A", active: true })],
      }),
    );
    const actions = PopupActions.make(runtime);
    expect(await actions.page()).toMatchObject({ title: "A", host: "example.com", savable: true });
    expect((await actions.load()).connection).toEqual({ _tag: "NotPaired" });
    expect(await actions.save()).toMatchObject({ _tag: "Failed" });

    await actions.connect();
    await actions.openStash("https://stash.example.com");
    const state = Effect.gen(function* () {
      const pages = yield* Testing.TestExtensionPages;
      const tabs = yield* (yield* Testing.TestTabs).all;
      return [yield* pages.optionsOpened, yield* pages.closed, tabs.at(-1)?.url];
    });
    expect(await runtime.runPromise(state)).toEqual([1, 2, "https://stash.example.com/"]);
    await runtime.dispose();
  });
});
