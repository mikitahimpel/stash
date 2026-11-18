import * as LinkEvents from "@stash/backend-platform/link-events";
import * as Events from "@stash/contracts-api/events";

// `GET /events` as a WebSocket. The Effect router cannot answer an upgrade (it copies a response
// to add the CORS headers, and the copy loses the socket), so the Worker does it here, in two
// steps:
//
// 1. It asks the router for the same path with the same credentials and no upgrade. The `events`
//    group answers 426 to an authenticated request and the middleware 401 to any other, so the
//    stream is guarded by the very `Authorization` every endpoint uses.
// 2. On 426 it hands the request to the user's `LinkEvents` object, which accepts the socket.
//
// The session cookie is `SameSite=Lax`, so a page of another site cannot open the stream with it.

/** The headers of the upgrade itself, left out of the plain request of step 1. */
const upgradeHeaders = /^(?:upgrade|connection|sec-websocket-.*)$/i;

/** The part of the `LINK_EVENTS` binding this module uses. */
export type Namespace = LinkEvents.Namespace<{ fetch(request: Request): Promise<Response> }>;

/**
 * Answers a WebSocket upgrade of `GET /events`, or `undefined` for any other request. `api`
 * is the composed `StashApi` handler, and `user` the login whose streams the object holds.
 */
export const handleEvents = async (
  request: Request,
  api: (request: Request) => Promise<Response>,
  namespace: Namespace | undefined,
  user: string,
): Promise<Response | undefined> => {
  if (request.method !== "GET" || new URL(request.url).pathname !== Events.path) return undefined;
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return undefined;
  const headers = new Headers(request.headers);
  for (const name of [...headers.keys()]) if (upgradeHeaders.test(name)) headers.delete(name);
  const checked = await api(new Request(request.url, { method: "GET", headers }));
  if (checked.status !== 426) return checked;
  if (namespace === undefined) return new Response("Live updates are off", { status: 503 });
  return LinkEvents.stub(namespace, user).fetch(request);
};
