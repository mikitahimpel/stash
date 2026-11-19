import * as Api from "@stash/contracts-api/api";
import * as Errors from "@stash/contracts-domain/errors";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";

/**
 * The `events` group of the `StashApi`: what `GET /events` answers over plain HTTP. An
 * authenticated request gets `426`, and the Worker takes that as the go-ahead to hand a WebSocket
 * upgrade to the user's `LinkEvents` object (`apps/api/src/events-upgrade.ts`). The stream itself
 * never passes through here. Needs the `Authorization` middleware.
 */
export const layer = HttpApiBuilder.group(Api.StashApi, "events", (handlers) =>
  handlers.handle("stream", () =>
    Effect.fail(new Errors.UpgradeRequired({ message: "GET /events is a WebSocket" })),
  ),
);
