import type * as HttpClientRequest from "effect/http/HttpClientRequest";

// Synthetic devices and tokens in their wire (JSON) form.

export const device = (id: string, name = `Device ${id}`, kind = "zen") => ({
  id,
  name,
  kind,
  createdAt: "2026-01-01T00:00:00.000Z",
});

export const token = (
  id: string,
  deviceId: string,
  options: { readonly createdAt?: string; readonly revokedAt?: string | null } = {},
) => ({
  id,
  deviceId,
  createdAt: options.createdAt ?? "2026-01-02T00:00:00.000Z",
  revokedAt: options.revokedAt ?? null,
});

/** A made-up plaintext, the kind of value only `POST /tokens` ever returns. */
export const plaintext = (id: string) => `stash_example_${id}`;

export const created = (id: string, deviceId: string) => ({
  ...token(id, deviceId),
  token: plaintext(id),
});

/** The JSON body of a stubbed request. */
export const body = (request: HttpClientRequest.HttpClientRequest): unknown =>
  request.body._tag === "Uint8Array" ? JSON.parse(new TextDecoder().decode(request.body.body)) : {};
