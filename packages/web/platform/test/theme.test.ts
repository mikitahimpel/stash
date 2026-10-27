import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as KeyValueStore from "effect/persistence/KeyValueStore";
import * as Stream from "effect/Stream";
import * as Testing from "../src/testing.ts";
import * as Theme from "../src/theme.ts";

// Lets the forked streams subscribe before the test changes state.
const settle = Effect.repeat(Effect.yieldNow, { times: 10 });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Theme (in memory)", () => {
  it.effect("defaults to system and follows a simulated media change", () =>
    Effect.gen(function* () {
      const theme = yield* Theme.Theme;
      const test = yield* Testing.TestTheme;
      expect(yield* theme.current).toEqual({ preference: "system", scheme: "light" });
      expect(yield* test.isDark).toBe(false);

      const fiber = yield* theme.changes.pipe(Stream.take(3), Stream.runCollect, Effect.forkChild);
      yield* settle;
      yield* test.setSystemScheme("dark");
      yield* settle;
      expect(yield* theme.current).toEqual({ preference: "system", scheme: "dark" });
      expect(yield* test.isDark).toBe(true);

      yield* test.setSystemScheme("light");
      yield* settle;
      expect(yield* test.isDark).toBe(false);
      expect(yield* Fiber.join(fiber)).toEqual([
        { preference: "system", scheme: "light" },
        { preference: "system", scheme: "dark" },
        { preference: "system", scheme: "light" },
      ]);
    }).pipe(Effect.provide(Testing.layerTheme().pipe(Layer.provide(Testing.layerKeyValueStore)))),
  );

  it.effect("starts dark when the OS is dark", () =>
    Effect.gen(function* () {
      expect(yield* (yield* Theme.Theme).current).toEqual({ preference: "system", scheme: "dark" });
      expect(yield* (yield* Testing.TestTheme).isDark).toBe(true);
    }).pipe(
      Effect.provide(
        Testing.layerTheme({ system: "dark" }).pipe(Layer.provide(Testing.layerKeyValueStore)),
      ),
    ),
  );

  it.effect("dark and light set and unset the class and persist across builds", () =>
    Effect.gen(function* () {
      const store = yield* KeyValueStore.KeyValueStore;
      const build = Effect.map(Layer.build(Testing.layerTheme()), (context) => ({
        theme: Context.get(context, Theme.Theme),
        test: Context.get(context, Testing.TestTheme),
      }));

      const first = yield* build;
      yield* first.theme.setPreference("dark");
      expect(yield* first.test.isDark).toBe(true);
      expect(yield* store.get(Theme.storageKey)).toBe("dark");

      // The OS scheme no longer matters once the preference is explicit.
      yield* first.test.setSystemScheme("dark");
      yield* first.theme.setPreference("light");
      expect(yield* first.test.isDark).toBe(false);
      expect(yield* first.theme.current).toEqual({ preference: "light", scheme: "light" });

      const second = yield* build;
      expect(yield* second.theme.current).toEqual({ preference: "light", scheme: "light" });
      yield* second.theme.setPreference("dark");

      const third = yield* build;
      expect(yield* third.theme.current).toEqual({ preference: "dark", scheme: "dark" });
      expect(yield* third.test.isDark).toBe(true);

      yield* third.theme.setPreference("system");
      expect(yield* third.test.isDark).toBe(false);
      expect(yield* store.get(Theme.storageKey)).toBe("system");
    }).pipe(Effect.scoped, Effect.provide(Testing.layerKeyValueStore)),
  );

  it.effect("ignores a stored value that is not a preference", () =>
    Effect.gen(function* () {
      const store = yield* KeyValueStore.KeyValueStore;
      yield* store.set(Theme.storageKey, "sepia");
      const context = yield* Layer.build(Testing.layerTheme());
      const theme = Context.get(context, Theme.Theme);
      expect(yield* theme.current).toEqual({ preference: "system", scheme: "light" });
    }).pipe(Effect.scoped, Effect.provide(Testing.layerKeyValueStore)),
  );
});

describe("Theme (live)", () => {
  it.effect("reads matchMedia, follows its changes and toggles the class on <html>", () => {
    const query = Object.assign(new EventTarget(), { matches: false });
    const classes = new Set<string>();
    vi.stubGlobal("window", { matchMedia: () => query });
    vi.stubGlobal("document", {
      documentElement: {
        classList: {
          toggle: (name: string, force: boolean) => {
            if (force) classes.add(name);
            else classes.delete(name);
            return force;
          },
        },
      },
    });
    return Effect.gen(function* () {
      const theme = yield* Theme.Theme;
      expect(classes.has("dark")).toBe(false);

      yield* settle;
      query.matches = true;
      query.dispatchEvent(new Event("change"));
      yield* settle;
      expect(yield* theme.current).toEqual({ preference: "system", scheme: "dark" });
      expect(classes.has("dark")).toBe(true);

      yield* theme.setPreference("light");
      expect(classes.has("dark")).toBe(false);
    }).pipe(Effect.provide(Theme.layer.pipe(Layer.provide(Testing.layerKeyValueStore))));
  });
});
