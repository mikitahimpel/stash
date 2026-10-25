import * as Links from "@stash/contracts-api/links";
import * as Security from "@stash/contracts-api/security";
import * as Errors from "@stash/contracts-domain/errors";
import type * as Link from "@stash/contracts-domain/link";
import { Context, DateTime, Effect, Layer, Redacted } from "effect";
import { FetchHttpClient, HttpRouter, HttpServer } from "effect/http";
import { HttpApi, HttpApiBuilder } from "effect/http-api";
import * as StashApiClient from "../src/stash-api-client.ts";

// A fake `apps/api` that serves the real links group from memory. It dedupes by URL like the real
// api, so a rerun stores nothing twice. The importer reaches it through its own `StashApiClient`
// layer over an in-process `fetch`, so requests take the real wire format. All data is synthetic.

/** Synthetic placeholder, not a real token. The stub accepts only this one. */
export const token = "synthetic-migrate-token";

const baseUrl = "https://api.example.com";
const now = DateTime.makeUnsafe("2026-01-02T03:04:05.000Z");

/** How the stub answers one `POST /links/batch` call. */
export type Answer = "ok" | "rate-limited" | "server-error";

export class StubApi extends Context.Service<
  StubApi,
  {
    /** Every link stored, once per URL. */
    readonly links: Effect.Effect<ReadonlyArray<Link.Link>>;
    /** The size of every batch the stub received, failed calls included. */
    readonly calls: Effect.Effect<ReadonlyArray<number>>;
  }
>()("@stash/migrate/test/StubApi") {}

// Only the links group: the full `StashApi` client calls the same paths.
class LinksApi extends HttpApi.make("stash").add(Links.LinksGroup) {}

const AuthorizationStub = Layer.succeed(
  Security.Authorization,
  Security.Authorization.of({
    bearer: (handler, { credential }) =>
      Redacted.value(credential) === token
        ? Effect.provideService(handler, Security.CurrentPrincipal, { kind: "user" })
        : Effect.fail(new Errors.Unauthorized({ message: "Invalid token" })),
    session: () => Effect.fail(new Errors.Unauthorized({ message: "No session" })),
  }),
);

const unsupported = Effect.die(new Error("The stub api only implements saveBatch"));

/**
 * `StashApiClient` backed by the stub, plus `StubApi` controls. Calls are answered from `answers` in
 * order, then with "ok".
 */
export const layer = (
  options: { readonly answers?: ReadonlyArray<Answer>; readonly token?: string } = {},
): Layer.Layer<StashApiClient.StashApiClient | StubApi> =>
  Layer.unwrap(
    Effect.gen(function* () {
      const links = new Map<string, Link.Link>();
      const calls: Array<number> = [];
      const answers = [...(options.answers ?? [])];

      const store = (input: Link.SaveLinkInput): Link.Link => {
        const known = links.get(input.url);
        if (known !== undefined) return known;
        const link: Link.Link = {
          id: `link-${links.size + 1}` as Link.LinkId,
          url: input.url,
          canonicalUrl: input.url,
          title: input.title ?? null,
          status: "new",
          type: null,
          summary: null,
          language: null,
          tags: [],
          sourceDeviceId: null,
          createdAt: now,
          enrichedAt: null,
        };
        links.set(input.url, link);
        return link;
      };

      const group = HttpApiBuilder.group(LinksApi, "links", (handlers) =>
        handlers
          .handle("saveBatch", ({ payload }) => {
            calls.push(payload.links.length);
            const answer = answers.shift() ?? "ok";
            if (answer === "rate-limited") {
              return Effect.fail(new Errors.RateLimited({ retryAfterSeconds: 0 }));
            }
            if (answer === "server-error") return Effect.die(new Error("synthetic outage"));
            return Effect.succeed({ links: payload.links.map(store) });
          })
          .handle("save", () => unsupported)
          .handle("list", () => unsupported)
          .handle("get", () => unsupported)
          .handle("update", () => unsupported)
          .handle("remove", () => unsupported),
      );

      const app = HttpApiBuilder.layer(LinksApi).pipe(
        Layer.provide(group),
        Layer.provide(AuthorizationStub),
        Layer.provide(HttpServer.layerServices),
      );
      const web = yield* Effect.acquireRelease(
        Effect.sync(() => HttpRouter.toWebHandler(app, { disableLogger: true })),
        (web) => Effect.promise(() => web.dispose()),
      );

      const httpClient = FetchHttpClient.layer.pipe(
        Layer.provide(
          Layer.succeed(FetchHttpClient.Fetch)(((input, init) =>
            web.handler(new Request(input, init))) as typeof globalThis.fetch),
        ),
      );
      return StashApiClient.layer({
        baseUrl,
        token: Redacted.make(options.token ?? token),
      }).pipe(
        Layer.provide(httpClient),
        Layer.merge(
          Layer.succeed(StubApi, {
            links: Effect.sync(() => [...links.values()]),
            calls: Effect.sync(() => [...calls]),
          }),
        ),
      );
    }),
  );
