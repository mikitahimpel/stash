import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

/** A key pressed anywhere on the page. */
export interface KeyPress {
  /** `KeyboardEvent.key`, for example `"k"`, `"/"` or `"Escape"`. */
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  /** Whether the focus is in a field that takes text, where a plain key types instead. */
  readonly typing: boolean;
  /**
   * Whether the focus is on a control that acts on keys itself, such as a link or a button (Enter
   * follows or presses it) or a radio (arrow keys move it).
   */
  readonly control: boolean;
  /** Whether an element under the page already handled the key (`event.defaultPrevented`). */
  readonly handled: boolean;
}

/**
 * Page-wide keyboard shortcuts: key presses on the whole page, and moving the focus.
 */
export class Keyboard extends Context.Service<
  Keyboard,
  {
    /**
     * Emits every key press that `match` accepts, and stops the browser's default action for it
     * (such as its own ⌘K). Other presses go on as usual.
     */
    readonly presses: (match: (press: KeyPress) => boolean) => Stream.Stream<KeyPress>;
    /** Focuses the first element that matches `selector`. `false` when there is none. */
    readonly focus: (selector: string) => Effect.Effect<boolean>;
  }
>()("@stash/web-platform/Keyboard") {}

// Fields where a plain key types text. Buttons, checkboxes and radios take no text.
const textField =
  "input:not([type=button],[type=checkbox],[type=radio],[type=reset],[type=submit]), textarea, select, [contenteditable]:not([contenteditable=false])";

// Controls that act on keys themselves: Enter follows a link or presses a button.
const control =
  "a[href], button, summary, [role=button], [role=link], [role=radio], [role=tab], [role=checkbox], [role=menuitem], [role=option]";

const matches = (target: EventTarget | null, selector: string): boolean =>
  target !== null &&
  "matches" in target &&
  typeof target.matches === "function" &&
  target.matches(selector) === true;

/**
 * The live service, backed by `keydown` on `document` and `document.querySelector`.
 */
export const layer: Layer.Layer<Keyboard> = Layer.succeed(Keyboard)({
  presses: (match) =>
    Stream.callback<KeyPress>((queue) => {
      const onKeydown = (event: KeyboardEvent) => {
        // Keys that compose a character (IME) are not shortcuts.
        if (event.isComposing) return;
        const press: KeyPress = {
          key: event.key,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          altKey: event.altKey,
          shiftKey: event.shiftKey,
          typing: matches(event.target, textField),
          control: matches(event.target, control),
          handled: event.defaultPrevented,
        };
        if (!match(press)) return;
        event.preventDefault();
        Queue.offerUnsafe(queue, press);
      };
      return Effect.acquireRelease(
        Effect.sync(() => document.addEventListener("keydown", onKeydown)),
        () => Effect.sync(() => document.removeEventListener("keydown", onKeydown)),
      );
    }),
  focus: (selector) =>
    Effect.sync(() => {
      const element = document.querySelector<HTMLElement>(selector);
      element?.focus();
      return element !== null;
    }),
});
