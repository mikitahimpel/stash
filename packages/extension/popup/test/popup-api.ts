import * as Effect from "effect/Effect";
import type * as HttpClientRequest from "effect/http/HttpClientRequest";

// A synthetic Stash api for the popup tests: a few links in memory behind the routes the popup
// calls. Every value is invented.

/** Synthetic placeholders, not real values. */
export const config = {
  apiBaseUrl: "https://stash.example.com/api",
  deviceToken: "synthetic-token",
};

/** A link as the api sends it. */
export interface StoredLink {
  readonly id: string;
  readonly url: string;
  readonly [field: string]: unknown;
}

export const link = (id: string, fields: Record<string, unknown> = {}): StoredLink => ({
  id,
  url: `https://example.com/${id}`,
  canonicalUrl: `https://example.com/${id}`,
  title: `Link ${id}`,
  status: "new",
  type: null,
  summary: null,
  language: null,
  imageUrl: null,
  tags: [],
  sourceDeviceId: "device-1",
  createdAt: "2026-01-01T00:00:00.000Z",
  enrichedAt: null,
  ...fields,
});

export interface Sent {
  readonly method: string;
  readonly path: string;
  readonly query: Record<string, string>;
}

export const make = (
  options: {
    readonly links?: ReadonlyArray<StoredLink>;
    /** Answers every request with this status instead. */
    readonly status?: number;
    /** `GET /auth/me`. */
    readonly principal?: unknown;
  } = {},
) => {
  const links = [...(options.links ?? [])];
  const sent: Array<Sent> = [];
  /** Runs before each `GET /links/:id`, to let enrichment "happen" between polls. */
  let beforeGet: (link: StoredLink) => StoredLink = (it) => it;
  const json = (body: unknown, status = 200) => Response.json(body, { status });
  const handler = (request: HttpClientRequest.HttpClientRequest) =>
    Effect.sync(() => {
      const url = new URL(request.url);
      const path = url.pathname.replace(/^\/api/, "");
      const query = Object.fromEntries(
        [...request.urlParams.params, ...url.searchParams].map(([name, value]) => [
          name,
          String(value),
        ]),
      );
      sent.push({ method: request.method, path, query });
      if (options.status !== undefined) {
        return json({ _tag: "Unauthorized", message: "synthetic" }, options.status);
      }
      if (path === "/auth/me") {
        return json(options.principal ?? { kind: "device", deviceId: "device-1" });
      }
      if (path === "/devices") {
        return json([
          {
            id: "device-0",
            name: "Old laptop",
            kind: "zen",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
          {
            id: "device-1",
            name: "Zen on desk",
            kind: "zen",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ]);
      }
      if (path === "/links" && request.method === "GET") {
        const wanted = query["url"];
        const items = wanted === undefined ? links : links.filter((it) => it.url === wanted);
        return json({ items: items.slice(0, Number(query["limit"] ?? 50)), nextCursor: null });
      }
      if (path === "/links" && request.method === "POST") {
        const body = JSON.parse(
          request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "{}",
        ) as { url: string; title?: string };
        const existing = links.find((it) => it.url === body.url);
        if (existing !== undefined) return json({ ...existing, created: false }, 201);
        const created = link("saved", { url: body.url, title: body.title ?? null });
        links.unshift(created);
        return json({ ...created, created: true }, 201);
      }
      const id = path.replace(/^\/links\//, "");
      const index = links.findIndex((it) => it.id === id);
      if (index === -1) return json({ _tag: "NotFound", resource: "link", id }, 404);
      if (request.method === "DELETE") {
        links.splice(index, 1);
        return new Response(null, { status: 204 });
      }
      links[index] = beforeGet(links[index]!);
      return json(links[index]);
    });
  return {
    handler,
    sent,
    links,
    beforeGet: (next: (link: StoredLink) => StoredLink) => {
      beforeGet = next;
    },
  };
};
