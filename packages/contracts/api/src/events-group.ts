import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import * as ErrorStatuses from "./error-statuses.ts";
import * as Security from "./security.ts";

/**
 * The live stream of link changes, `GET /events`, guarded like every other endpoint.
 *
 * It is a WebSocket: a request with `Upgrade: websocket` answers `101` and then sends one text
 * message per `LinkEvent` (`@stash/contracts-domain/link-event`, as JSON), `stream.ready` first.
 * Nothing is replayed: after a gap a client catches up with `GET /links?updatedSince=<at>`. The
 * client may send the text `ping` and gets `pong` back.
 *
 * `HttpApi` describes plain HTTP only, so the endpoint below is what a request without the
 * upgrade gets: `426` with `UpgradeRequired`, or `401`. A typed client never succeeds here; it
 * opens the path as a WebSocket instead.
 */
export const path = "/events";

export class EventsGroup extends HttpApiGroup.make("events")
  .add(HttpApiEndpoint.get("stream", path, { error: ErrorStatuses.UpgradeRequired }))
  .middleware(Security.Authorization) {}
