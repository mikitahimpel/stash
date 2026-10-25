import { describe, expect, it } from "@effect/vitest";
import * as Testing from "@stash/backend-platform/testing";
import * as Api from "@stash/contracts-api/api";
import * as Security from "@stash/contracts-api/security";
import * as Errors from "@stash/contracts-domain/errors";
import * as Link from "@stash/contracts-domain/link";
import * as Tag from "@stash/contracts-domain/tag";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as HttpServer from "effect/http/HttpServer";
import * as HttpApiError from "effect/http-api/HttpApiError";
import * as HttpApiMiddleware from "effect/http-api/HttpApiMiddleware";
import * as HttpApiTest from "effect/http-api/HttpApiTest";
import * as Layer from "effect/Layer";
import * as LinksHandlers from "../src/links-handlers.ts";
import * as LinksTestLayer from "./links-test-layer.ts";

// End to end through the contracts `StashApi`: request encoding, routing and the `links` handlers,
// on an in-memory D1, queue and KV. `Authorization` is stubbed to admit the synthetic device.

const layerAuthorizationStub = Layer.succeed(Security.Authorization)({
  bearer: (handler) =>
    Effect.provideService(handler, Security.CurrentPrincipal, LinksTestLayer.device),
  session: (handler) =>
    Effect.provideService(handler, Security.CurrentPrincipal, LinksTestLayer.device),
});

const server = (rateLimit?: { limit: number; windowSeconds: number }) =>
  LinksHandlers.layer.pipe(
    Layer.provideMerge(layerAuthorizationStub),
    Layer.provideMerge(LinksTestLayer.layer(rateLimit)),
    Layer.merge(HttpServer.layerServices),
  );

const client = HttpApiTest.groups(Api.StashApi, ["links"]).pipe(
  Effect.provide(
    HttpApiMiddleware.layerClient(Security.Authorization, ({ next, request }) => next(request)),
  ),
);

const url = (value: string) => Link.Url.make(value);

describe("links handlers", () => {
  it.effect("saves, gets, lists, patches and deletes a link over HTTP", () =>
    Effect.gen(function* () {
      const { links } = yield* client;
      const saved = yield* links.save({
        payload: {
          url: url("https://example.com/http?utm_source=x"),
          tags: [Tag.TagName.make("x")],
        },
      });
      expect(saved).toMatchObject({
        canonicalUrl: "https://example.com/http",
        sourceDeviceId: LinksTestLayer.deviceId,
        tags: ["x"],
      });
      const queued = yield* Testing.TestEnrichmentQueue.use((queue) => queue.drain);
      expect(queued).toEqual([{ linkId: saved.id }]);

      expect(yield* links.get({ params: { id: saved.id } })).toEqual(saved);
      expect(yield* links.list({ query: { seen: false } })).toEqual({
        items: [saved],
        nextCursor: null,
      });

      const patched = yield* links.update({
        params: { id: saved.id },
        payload: { status: "done" },
      });
      expect(patched.status).toBe("done");

      yield* links.remove({ params: { id: saved.id } });
      const error = yield* links.get({ params: { id: saved.id } }).pipe(Effect.flip);
      expect(error).toEqual(new Errors.NotFound({ resource: "link", id: saved.id }));
    }).pipe(Effect.provide(server())),
  );

  it.effect("saves a batch and answers RateLimited past the limit", () =>
    Effect.gen(function* () {
      const { links } = yield* client;
      const saved = yield* links.saveBatch({
        payload: {
          links: [{ url: url("https://example.com/1") }, { url: url("https://example.com/1/") }],
        },
      });
      expect(saved.links).toHaveLength(2);
      expect(saved.links[1]?.id).toBe(saved.links[0]?.id);

      const error = yield* links
        .save({ payload: { url: url("https://example.com/2") } })
        .pipe(Effect.flip);
      expect(error).toBeInstanceOf(Errors.RateLimited);
    }).pipe(Effect.provide(server({ limit: 1, windowSeconds: 60 }))),
  );

  // The in-memory test client surfaces the respondable defect itself. `apps/api` checks the 400.
  it.effect("rejects an unknown cursor with BadRequest", () =>
    Effect.gen(function* () {
      const { links } = yield* client;
      const exit = yield* links.list({ query: { cursor: "bogus" } }).pipe(Effect.exit);
      expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toBeInstanceOf(
        HttpApiError.BadRequest,
      );
    }).pipe(Effect.provide(server())),
  );
});
