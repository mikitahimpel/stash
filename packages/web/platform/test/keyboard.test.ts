import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import * as Keyboard from "../src/keyboard.ts";
import * as Testing from "../src/testing.ts";

// Lets the forked stream subscribe before the test presses keys.
const settle = Effect.repeat(Effect.yieldNow, { times: 10 });

afterEach(() => {
  vi.unstubAllGlobals();
});

const isSlash = (press: Keyboard.KeyPress) => press.key === "/" && !press.typing;

// A synthetic keydown, dispatched on `doc` with `target` as its target.
const keydown = (
  doc: EventTarget,
  init: { key: string; metaKey?: boolean; isComposing?: boolean },
  target: { matches: (selector: string) => boolean } | null = null,
) => {
  const event = Object.assign(new Event("keydown", { cancelable: true }), {
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    isComposing: false,
    ...init,
  });
  if (target !== null) Object.defineProperty(event, "target", { value: target });
  doc.dispatchEvent(event);
  return event;
};

describe("Keyboard (live)", () => {
  it.effect("emits matching keydowns and stops their default action", () => {
    const doc = new EventTarget();
    vi.stubGlobal("document", doc);
    const field = { matches: (selector: string) => selector.includes("textarea") };
    return Effect.gen(function* () {
      const keyboard = yield* Keyboard.Keyboard;
      const fiber = yield* keyboard
        .presses(isSlash)
        .pipe(Stream.take(1), Stream.runCollect, Effect.forkChild);
      yield* settle;
      const other = keydown(doc, { key: "a" });
      const typed = keydown(doc, { key: "/" }, field);
      const composing = keydown(doc, { key: "/", isComposing: true });
      const slash = keydown(doc, { key: "/" });
      expect(yield* Fiber.join(fiber)).toEqual([
        {
          key: "/",
          metaKey: false,
          ctrlKey: false,
          altKey: false,
          shiftKey: false,
          typing: false,
          control: false,
          handled: false,
        },
      ]);
      expect([other, typed, composing, slash].map((event) => event.defaultPrevented)).toEqual([
        false,
        false,
        false,
        true,
      ]);
    }).pipe(Effect.provide(Keyboard.layer));
  });

  it.effect("tells presses on controls and presses already handled apart", () => {
    const doc = new EventTarget();
    vi.stubGlobal("document", doc);
    const button = { matches: (selector: string) => selector.includes("button") };
    return Effect.gen(function* () {
      const keyboard = yield* Keyboard.Keyboard;
      const fiber = yield* keyboard
        .presses((press) => press.key === "Enter")
        .pipe(Stream.take(3), Stream.runCollect, Effect.forkChild);
      yield* settle;
      keydown(doc, { key: "Enter" }, button);
      const handled = Object.assign(new Event("keydown", { cancelable: true }), { key: "Enter" });
      handled.preventDefault();
      doc.dispatchEvent(handled);
      keydown(doc, { key: "Enter" });
      expect(
        (yield* Fiber.join(fiber)).map(({ control, handled }) => ({ control, handled })),
      ).toEqual([
        { control: true, handled: false },
        { control: false, handled: true },
        { control: false, handled: false },
      ]);
    }).pipe(Effect.provide(Keyboard.layer));
  });

  it.effect("stops listening when the stream ends", () => {
    const doc = new EventTarget();
    vi.stubGlobal("document", doc);
    return Effect.gen(function* () {
      const keyboard = yield* Keyboard.Keyboard;
      const fiber = yield* keyboard
        .presses(isSlash)
        .pipe(Stream.take(1), Stream.runCollect, Effect.forkChild);
      yield* settle;
      keydown(doc, { key: "/" });
      yield* Fiber.join(fiber);
      expect(keydown(doc, { key: "/" }).defaultPrevented).toBe(false);
    }).pipe(Effect.provide(Keyboard.layer));
  });

  it.effect("focuses the first element that matches", () => {
    const focused: Array<string> = [];
    vi.stubGlobal("document", {
      querySelector: (selector: string) =>
        selector === "main input" ? { focus: () => focused.push(selector) } : null,
    });
    return Effect.gen(function* () {
      const keyboard = yield* Keyboard.Keyboard;
      expect(yield* keyboard.focus("main input")).toBe(true);
      expect(yield* keyboard.focus("main textarea")).toBe(false);
      expect(focused).toEqual(["main input"]);
    }).pipe(Effect.provide(Keyboard.layer));
  });
});

describe("Keyboard (in memory)", () => {
  it.effect("emits simulated presses that match and records focus", () =>
    Effect.gen(function* () {
      const keyboard = yield* Keyboard.Keyboard;
      const test = yield* Testing.TestKeyboard;
      const fiber = yield* keyboard
        .presses(isSlash)
        .pipe(Stream.take(1), Stream.runCollect, Effect.forkChild);
      yield* settle;
      expect(yield* test.press({ key: "/", typing: true })).toBe(false);
      expect(yield* test.press({ key: "/" })).toBe(true);
      expect((yield* Fiber.join(fiber)).map((press) => press.key)).toEqual(["/"]);
      expect(yield* keyboard.focus("main input")).toBe(true);
      expect(yield* test.focused).toEqual(["main input"]);
    }).pipe(Effect.provide(Testing.layerKeyboard)),
  );
});
