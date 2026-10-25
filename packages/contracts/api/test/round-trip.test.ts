import { assert, describe, layer } from "@effect/vitest";
import * as Command from "@stash/contracts-domain/command";
import * as Device from "@stash/contracts-domain/device";
import * as Errors from "@stash/contracts-domain/errors";
import * as Link from "@stash/contracts-domain/link";
import * as Tab from "@stash/contracts-domain/tab";
import * as Tag from "@stash/contracts-domain/tag";
import { DateTime, Effect, Layer, Option, Redacted, Schema } from "effect";
import { HttpClientRequest, HttpServer } from "effect/http";
import { HttpApiBuilder, HttpApiMiddleware, HttpApiTest } from "effect/http-api";
import * as Api from "../src/stash-api.ts";
import * as Security from "../src/security.ts";

// Synthetic placeholder, not a real token.
const deviceToken = "synthetic-test-token";
const deviceId = Device.DeviceId.make("device-1");
const economics = Tag.TagName.make("economics");
const now = DateTime.makeUnsafe("2026-01-02T03:04:05.000Z");

// --- Stub server: in-memory handlers that only prove the wire format. ---

const AuthorizationStub = Layer.succeed(
  Security.Authorization,
  Security.Authorization.of({
    bearer: (handler, { credential }) =>
      Redacted.value(credential) === deviceToken
        ? Effect.provideService(handler, Security.CurrentPrincipal, { kind: "device", deviceId })
        : Effect.fail(new Errors.Unauthorized({ message: "Invalid token" })),
    session: () => Effect.fail(new Errors.Unauthorized({ message: "No session" })),
  }),
);

const links = new Map<Link.LinkId, Link.Link>();
const snapshots = new Map<Device.DeviceId, Tab.TabsSnapshot>();

const makeLink = (
  input: Link.SaveLinkInput,
  sourceDeviceId: Device.DeviceId | null,
): Link.Link => ({
  id: Link.LinkId.make(`link-${links.size + 1}`),
  url: input.url,
  canonicalUrl: null,
  title: input.title ?? null,
  status: "new",
  type: null,
  summary: null,
  language: null,
  tags: input.tags ?? [],
  sourceDeviceId,
  createdAt: now,
  enrichedAt: null,
});

const store = (link: Link.Link) => {
  links.set(link.id, link);
  return link;
};

const sourceDevice = Effect.map(Security.CurrentPrincipal, (principal) =>
  principal.kind === "device" ? principal.deviceId : null,
);

const find = (id: Link.LinkId) =>
  Option.fromNullishOr(links.get(id)).pipe(
    Effect.fromOption,
    Effect.mapError(() => new Errors.NotFound({ resource: "link", id })),
  );

const LinksStub = HttpApiBuilder.group(Api.StashApi, "links", (handlers) =>
  handlers
    .handle("save", ({ payload }) =>
      payload.url.includes("rate-limited")
        ? Effect.fail(new Errors.RateLimited({ retryAfterSeconds: 30 }))
        : Effect.map(sourceDevice, (device) => store(makeLink(payload, device))),
    )
    .handle("saveBatch", ({ payload }) =>
      Effect.map(sourceDevice, (device) => ({
        links: payload.links.map((input) => store(makeLink(input, device))),
      })),
    )
    .handle("list", ({ query }) =>
      Effect.succeed({
        items: [...links.values()].filter(
          (link) =>
            (query.status === undefined || link.status === query.status) &&
            (query.seen === undefined || (link.status !== "new") === query.seen),
        ),
        nextCursor: null,
      }),
    )
    .handle("get", ({ params }) => find(params.id))
    .handle("update", ({ params, payload }) =>
      Effect.map(find(params.id), (link) => store({ ...link, ...payload })),
    )
    .handle("remove", ({ params }) =>
      Effect.map(find(params.id), (link) => {
        links.delete(link.id);
      }),
    ),
);

const TabsStub = HttpApiBuilder.group(Api.StashApi, "tabs", (handlers) =>
  handlers
    .handle("report", ({ params, payload }) =>
      Effect.sync(() => {
        snapshots.set(params.id, { deviceId: params.id, ...payload });
      }),
    )
    .handle("list", () =>
      Effect.succeed({
        devices: [...snapshots.values()].map((snapshot) => ({
          device: {
            id: snapshot.deviceId,
            name: "Synthetic Zen",
            kind: "zen" as const,
            createdAt: now,
          },
          snapshot,
        })),
      }),
    )
    .handle("archive", ({ payload }) =>
      Effect.succeed({
        link: store(makeLink({ url: payload.url }, payload.deviceId)),
        command: {
          id: Command.CommandId.make("command-1"),
          deviceId: payload.deviceId,
          payload: { kind: "close-tab" as const, url: payload.url },
          status: "pending" as const,
          createdAt: now,
          completedAt: null,
        },
      }),
    ),
);

const ServerStub = Layer.mergeAll(LinksStub, TabsStub).pipe(
  Layer.provideMerge(AuthorizationStub),
  Layer.merge(HttpServer.layerServices),
);

// --- Client side: what a token client (extension, mac-agent, Shortcut) provides. ---

const withToken = (token: string) =>
  HttpApiMiddleware.layerClient(Security.Authorization, ({ next, request }) =>
    next(HttpClientRequest.bearerToken(request, token)),
  );

const makeClient = HttpApiTest.groups(Api.StashApi, ["links", "tabs"]);

const url = (value: string) => Schema.decodeUnknownSync(Link.Url)(value);

layer(ServerStub)("HttpApiClient round-trip", (it) => {
  describe("links", () => {
    it.effect("saves, fetches, filters, updates and deletes a link", () =>
      Effect.gen(function* () {
        const client = yield* makeClient;

        const saved = yield* client.links.save({
          payload: { url: url("https://example.com/articles/one"), title: "One" },
        });
        assert.strictEqual(saved.title, "One");
        assert.strictEqual(saved.status, "new");
        assert.strictEqual(saved.sourceDeviceId, deviceId);
        assert.isTrue(DateTime.isDateTime(saved.createdAt));
        assert.isTrue(DateTime.Equivalence(saved.createdAt, now));

        const fetched = yield* client.links.get({ params: { id: saved.id } });
        assert.deepStrictEqual(fetched, saved);

        const updated = yield* client.links.update({
          params: { id: saved.id },
          payload: { status: "seen", tags: [economics] },
        });
        assert.strictEqual(updated.status, "seen");
        assert.deepStrictEqual(updated.tags, [economics]);

        const unseen = yield* client.links.list({ query: { seen: false } });
        assert.isFalse(unseen.items.some((link) => link.id === saved.id));
        const seen = yield* client.links.list({ query: { seen: true, limit: 10 } });
        assert.isTrue(seen.items.some((link) => link.id === saved.id));
        assert.isNull(seen.nextCursor);

        yield* client.links.remove({ params: { id: saved.id } });
        const missing = yield* client.links.get({ params: { id: saved.id } }).pipe(Effect.flip);
        assert.strictEqual(missing._tag, "NotFound");
      }).pipe(Effect.provide(withToken(deviceToken))),
    );

    it.effect("saves a batch", () =>
      Effect.gen(function* () {
        const client = yield* makeClient;
        const result = yield* client.links.saveBatch({
          payload: {
            links: [
              { url: url("https://example.com/batch/1") },
              { url: url("https://example.com/batch/2") },
            ],
          },
        });
        assert.deepStrictEqual(
          result.links.map((link) => link.url),
          ["https://example.com/batch/1", "https://example.com/batch/2"],
        );
      }).pipe(Effect.provide(withToken(deviceToken))),
    );

    it.effect("decodes RateLimited with its payload", () =>
      Effect.gen(function* () {
        const client = yield* makeClient;
        const error = yield* client.links
          .save({ payload: { url: url("https://example.com/rate-limited") } })
          .pipe(Effect.flip);
        assert.instanceOf(error, Errors.RateLimited);
        assert.deepStrictEqual(error, new Errors.RateLimited({ retryAfterSeconds: 30 }));
      }).pipe(Effect.provide(withToken(deviceToken))),
    );

    it.effect("rejects an empty batch before it reaches the server", () =>
      Effect.gen(function* () {
        const client = yield* makeClient;
        const error = yield* client.links.saveBatch({ payload: { links: [] } }).pipe(Effect.flip);
        assert.strictEqual(error._tag, "SchemaError");
      }).pipe(Effect.provide(withToken(deviceToken))),
    );

    it.effect("fails with Unauthorized for a wrong token", () =>
      Effect.gen(function* () {
        const client = yield* makeClient;
        const error = yield* client.links.list({ query: {} }).pipe(Effect.flip);
        assert.instanceOf(error, Errors.Unauthorized);
      }).pipe(Effect.provide(withToken("wrong-synthetic-token"))),
    );
  });

  describe("tabs", () => {
    it.effect("reports a snapshot, lists it and archives a tab", () =>
      Effect.gen(function* () {
        const client = yield* makeClient;
        const tab = {
          url: url("https://example.com/open/tab"),
          title: "An open tab",
          openedAt: null,
          lastSeenAt: now,
        };

        yield* client.tabs.report({
          params: { id: deviceId },
          payload: { takenAt: now, tabs: [tab] },
        });

        const all = yield* client.tabs.list();
        assert.strictEqual(all.devices.length, 1);
        const [entry] = all.devices;
        assert.strictEqual(entry!.device.id, deviceId);
        assert.deepStrictEqual(entry!.snapshot, { deviceId, takenAt: now, tabs: [tab] });

        const archived = yield* client.tabs.archive({ payload: { deviceId, url: tab.url } });
        assert.strictEqual(archived.link.url, tab.url);
        assert.deepStrictEqual(archived.command.payload, { kind: "close-tab", url: tab.url });
        assert.strictEqual(archived.command.status, "pending");
      }).pipe(Effect.provide(withToken(deviceToken))),
    );
  });
});
