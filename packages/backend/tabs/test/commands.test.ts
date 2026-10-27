import { describe, expect, it } from "@effect/vitest";
import * as Command from "@stash/contracts-domain/command";
import * as Device from "@stash/contracts-domain/device";
import * as Errors from "@stash/contracts-domain/errors";
import * as Link from "@stash/contracts-domain/link";
import * as Effect from "effect/Effect";
import * as AckCommand from "../src/commands/ack-command.ts";
import * as EnqueueCommand from "../src/commands/enqueue-command.ts";
import * as ListPendingCommands from "../src/commands/list-pending-commands.ts";
import * as TabsTestLayer from "./tabs-test-layer.ts";

const closeTab = (url: string): Command.CommandPayload => ({
  kind: "close-tab",
  url: Link.Url.make(url),
});

const zenA = TabsTestLayer.asDevice(TabsTestLayer.zenA);
const zenB = TabsTestLayer.asDevice(TabsTestLayer.zenB);

describe("commands", () => {
  it.effect("moves a command from pending to done, once", () =>
    Effect.gen(function* () {
      const queued = yield* EnqueueCommand.enqueueCommand(
        TabsTestLayer.zenA,
        closeTab("https://example.com/a"),
      );
      expect(queued).toMatchObject({ status: "pending", completedAt: null });

      const pending = yield* ListPendingCommands.listCommands(zenA, TabsTestLayer.zenA, "pending");
      expect(pending).toEqual([queued]);

      const done = yield* AckCommand.ackCommand(zenA, queued.id, "done");
      expect(done).toMatchObject({ id: queued.id, status: "done", payload: queued.payload });
      expect(done.completedAt).not.toBeNull();

      expect(yield* ListPendingCommands.listCommands(zenA, TabsTestLayer.zenA, "pending")).toEqual(
        [],
      );
      expect(yield* ListPendingCommands.listCommands(zenA, TabsTestLayer.zenA)).toEqual([done]);

      const again = yield* AckCommand.ackCommand(zenA, queued.id, "failed").pipe(Effect.flip);
      expect(again).toBeInstanceOf(Errors.Conflict);
    }).pipe(Effect.provide(TabsTestLayer.layer)),
  );

  it.effect("records a failed outcome and lists commands oldest first by status", () =>
    Effect.gen(function* () {
      const first = yield* EnqueueCommand.enqueueCommand(
        TabsTestLayer.zenA,
        closeTab("https://example.com/1"),
      );
      const second = yield* EnqueueCommand.enqueueCommand(
        TabsTestLayer.zenA,
        closeTab("https://example.com/2"),
      );
      yield* EnqueueCommand.enqueueCommand(TabsTestLayer.zenB, closeTab("https://example.com/3"));
      yield* AckCommand.ackCommand(TabsTestLayer.user, first.id, "failed");

      const list = (status?: Command.CommandStatus) =>
        ListPendingCommands.listCommands(zenA, TabsTestLayer.zenA, status).pipe(
          Effect.map((commands) => commands.map((command) => command.id)),
        );
      expect(yield* list("pending")).toEqual([second.id]);
      expect(yield* list("failed")).toEqual([first.id]);
      expect(yield* list()).toEqual([first.id, second.id]);
    }).pipe(Effect.provide(TabsTestLayer.layer)),
  );

  it.effect("keeps a device to its own commands", () =>
    Effect.gen(function* () {
      const queued = yield* EnqueueCommand.enqueueCommand(
        TabsTestLayer.zenA,
        closeTab("https://example.com/a"),
      );
      const read = yield* ListPendingCommands.listCommands(zenB, TabsTestLayer.zenA).pipe(
        Effect.flip,
      );
      expect(read).toBeInstanceOf(Errors.Forbidden);
      const ack = yield* AckCommand.ackCommand(zenB, queued.id, "done").pipe(Effect.flip);
      expect(ack).toBeInstanceOf(Errors.Forbidden);
      expect(
        yield* ListPendingCommands.listCommands(TabsTestLayer.user, TabsTestLayer.zenA, "pending"),
      ).toEqual([queued]);
    }).pipe(Effect.provide(TabsTestLayer.layer)),
  );

  it.effect("answers NotFound for an unknown device or command", () =>
    Effect.gen(function* () {
      const unknown = Device.DeviceId.make("device-unknown");
      const enqueue = yield* EnqueueCommand.enqueueCommand(
        unknown,
        closeTab("https://example.com/a"),
      ).pipe(Effect.flip);
      expect(enqueue).toEqual(new Errors.NotFound({ resource: "device", id: unknown }));

      const id = Command.CommandId.make("command-unknown");
      const ack = yield* AckCommand.ackCommand(zenA, id, "done").pipe(Effect.flip);
      expect(ack).toEqual(new Errors.NotFound({ resource: "command", id }));
    }).pipe(Effect.provide(TabsTestLayer.layer)),
  );
});
