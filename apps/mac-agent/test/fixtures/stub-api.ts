/**
 * A stub of the two Stash API endpoints the poster calls (`POST /devices`, `PUT /devices/:id/tabs`),
 * served through an in-memory `HttpClient`. It records every request so tests can assert on them.
 * All values are synthetic.
 */
import { Effect, Layer } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import type { HttpClientRequest } from "effect/http";

export const baseUrl = "https://api.example.com";
/** A synthetic placeholder, not a real token. */
export const deviceToken = "synthetic-device-token";

export interface Recorded {
  readonly method: string;
  readonly path: string;
  readonly authorization: string | undefined;
  readonly body: unknown;
}

export interface StubApi {
  readonly requests: Array<Recorded>;
  /** Stash device ids the stub knows. Delete one to simulate a device removed in the web app. */
  readonly devices: Set<string>;
  /** When true, every request fails with `401 Unauthorized`. */
  unauthorized: boolean;
  readonly layer: Layer.Layer<HttpClient.HttpClient>;
}

const bodyOf = (request: HttpClientRequest.HttpClientRequest): unknown =>
  request.body._tag === "Uint8Array"
    ? JSON.parse(new TextDecoder().decode(request.body.body))
    : undefined;

export const make = (): StubApi => {
  const stub: StubApi = {
    requests: [],
    devices: new Set(),
    unauthorized: false,
    layer: Layer.succeed(HttpClient.HttpClient)(
      HttpClient.make((request, url) =>
        Effect.sync(() => {
          stub.requests.push({
            method: request.method,
            path: url.pathname,
            authorization: request.headers["authorization"],
            body: bodyOf(request),
          });
          return HttpClientResponse.fromWeb(request, respond(request.method, url.pathname));
        }),
      ),
    ),
  };

  const respond = (method: string, path: string): Response => {
    if (stub.unauthorized) {
      return Response.json({ _tag: "Unauthorized", message: "Stub failure" }, { status: 401 });
    }
    if (method === "POST" && path === "/devices") {
      const id = `stash-device-${stub.devices.size + 1}`;
      stub.devices.add(id);
      const body = stub.requests.at(-1)?.body as { name: string; kind: string };
      return Response.json(
        { id, name: body.name, kind: body.kind, createdAt: "2026-01-01T00:00:00.000Z" },
        { status: 201 },
      );
    }
    const report = /^\/devices\/([^/]+)\/tabs$/.exec(path);
    if (method === "PUT" && report !== null) {
      const id = decodeURIComponent(report[1]!);
      return stub.devices.has(id)
        ? new Response(null, { status: 204 })
        : Response.json({ _tag: "NotFound", resource: "device", id }, { status: 404 });
    }
    return new Response(null, { status: 500 });
  };

  return stub;
};
