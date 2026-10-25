import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientError from "effect/http/HttpClientError";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Layer from "effect/Layer";

// A scripted `HttpClient`. No request leaves the process: a URL without a route fails with a
// transport error.

/** One scripted answer: a body with headers, a status, a transport failure, or no answer at all. */
export type Reply =
  | { readonly status?: number; readonly body?: string; readonly contentType?: string }
  | "transport-error"
  | "hang";

export type Route = Reply | ((attempt: number) => Reply);

export class FakeHttp extends Context.Service<
  FakeHttp,
  { readonly requests: Effect.Effect<ReadonlyArray<HttpClientRequest.HttpClientRequest>> }
>()("@stash/backend-enrichment/test/FakeHttp") {}

const keyOf = (url: URL) => `${url.origin}${url.pathname}${url.search}`;

export const layer = (
  routes: Readonly<Record<string, Route>>,
): Layer.Layer<HttpClient.HttpClient | FakeHttp> =>
  Layer.effectContext(
    Effect.sync(() => {
      const requests: Array<HttpClientRequest.HttpClientRequest> = [];
      const attempts = new Map<string, number>();
      const client = HttpClient.make((request, url) => {
        requests.push(request);
        const key = keyOf(url);
        const attempt = (attempts.get(key) ?? 0) + 1;
        attempts.set(key, attempt);
        const route = routes[key];
        const reply = typeof route === "function" ? route(attempt) : route;
        if (reply === undefined || reply === "transport-error") {
          return Effect.fail(
            new HttpClientError.HttpClientError({
              reason: new HttpClientError.TransportError({ request, description: "no route" }),
            }),
          );
        }
        if (reply === "hang") return Effect.never;
        return Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            new Response(reply.body ?? "", {
              status: reply.status ?? 200,
              headers: { "content-type": reply.contentType ?? "text/html; charset=utf-8" },
            }),
          ),
        );
      });
      return Context.make(HttpClient.HttpClient, client).pipe(
        Context.add(FakeHttp, { requests: Effect.sync(() => [...requests]) }),
      );
    }),
  );
