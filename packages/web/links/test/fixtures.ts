import * as ApiTesting from "@stash/web-api-client/testing";
import * as Effect from "effect/Effect";
import type * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as UrlParams from "effect/http/UrlParams";

// Synthetic links in their wire (JSON) form.
export const link = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  url: `https://www.example.com/articles/${id}`,
  canonicalUrl: null,
  title: `Example article ${id}`,
  status: "new",
  type: "article",
  summary: `A summary of article ${id}.`,
  language: "en",
  tags: ["economics"],
  sourceDeviceId: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  enrichedAt: null,
  ...overrides,
});

export const page = (
  links: ReadonlyArray<ReturnType<typeof link>>,
  nextCursor: string | null = null,
) => ApiTesting.json({ items: links, nextCursor });

/** The query string of a request, as a plain record. */
export const query = (request: HttpClientRequest.HttpClientRequest): Record<string, string> =>
  Object.fromEntries(
    Object.entries(UrlParams.toRecord(request.urlParams)).map(([key, value]) => [
      key,
      typeof value === "string" ? value : value[0],
    ]),
  );

/** The JSON body of a request. */
export const body = (request: HttpClientRequest.HttpClientRequest): Effect.Effect<unknown> =>
  Effect.sync(() =>
    request.body._tag === "Uint8Array"
      ? JSON.parse(new TextDecoder().decode(request.body.body))
      : undefined,
  );
