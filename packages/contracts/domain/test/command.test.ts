import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import * as Command from "../src/command.ts";

const command = {
  id: "command-1",
  deviceId: "device-1",
  payload: { kind: "close-tab", url: "https://example.com/old-tab" },
  status: "pending",
  createdAt: "2026-01-02T03:04:05.000Z",
  completedAt: null,
};

describe("CommandKind", () => {
  it("matches the kinds of the payload union", () => {
    expect(Schema.is(Command.CommandKind)("close-tab")).toBe(true);
    expect(Schema.is(Command.CommandKind)("reboot")).toBe(false);
  });
});

describe("CommandStatus", () => {
  it("accepts pending, done and failed only", () => {
    for (const status of ["pending", "done", "failed"]) {
      expect(Schema.is(Command.CommandStatus)(status)).toBe(true);
    }
    expect(Schema.is(Command.CommandStatus)("running")).toBe(false);
  });
});

describe("Command", () => {
  it("round-trips", () => {
    const decoded = Schema.decodeUnknownSync(Command.Command)(command);
    expect(decoded.payload.kind).toBe("close-tab");
    expect(Schema.encodeSync(Command.Command)(decoded)).toEqual(command);
  });

  it.each([
    ["an unknown payload kind", { payload: { kind: "reboot" } }],
    ["a close-tab payload without url", { payload: { kind: "close-tab" } }],
    ["an unknown status", { status: "running" }],
  ])("rejects %s", (_, patch) => {
    expect(() => Schema.decodeUnknownSync(Command.Command)({ ...command, ...patch })).toThrow();
  });
});
