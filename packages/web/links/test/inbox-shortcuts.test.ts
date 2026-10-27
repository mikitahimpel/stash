import type * as Keyboard from "@stash/web-platform/keyboard";
import { describe, expect, it } from "vitest";
import * as InboxShortcuts from "../src/list/inbox-shortcuts.ts";

const press = (key: string, overrides: Partial<Keyboard.KeyPress> = {}): Keyboard.KeyPress => ({
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  typing: false,
  control: false,
  handled: false,
  ...overrides,
});

describe("command", () => {
  it("maps the Inbox keys", () => {
    expect(
      ["ArrowUp", "ArrowDown", "Enter", "s", "S", "d", "e", "x"].map((key) =>
        InboxShortcuts.command(press(key)),
      ),
    ).toEqual(["previous", "next", "open", "seen", "seen", "done", "archive", undefined]);
  });

  it("ignores keys typed into a field, already handled or with a modifier", () => {
    expect(InboxShortcuts.command(press("s", { typing: true }))).toBeUndefined();
    expect(InboxShortcuts.command(press("ArrowDown", { handled: true }))).toBeUndefined();
    expect(InboxShortcuts.command(press("d", { metaKey: true }))).toBeUndefined();
    expect(InboxShortcuts.command(press("e", { ctrlKey: true }))).toBeUndefined();
  });

  it("leaves ↵ on a link or button to it, but takes the other keys there", () => {
    expect(InboxShortcuts.command(press("Enter", { control: true }))).toBeUndefined();
    expect(InboxShortcuts.command(press("ArrowDown", { control: true }))).toBe("next");
  });
});
