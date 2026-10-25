import { assert, describe, it } from "@effect/vitest";
import * as Device from "@stash/contracts-domain/device";
import * as Errors from "@stash/contracts-domain/errors";
import * as Link from "@stash/contracts-domain/link";
import * as Tag from "@stash/contracts-domain/tag";
import { Effect, Layer, Schema } from "effect";
import * as ApiClient from "../src/api-client.ts";
import * as Testing from "../src/testing.ts";

const url = (value: string) => Schema.decodeUnknownSync(Link.Url)(value);

const zen: Device.Device = {
  id: Device.DeviceId.make("device-zen"),
  name: "Synthetic Zen",
  kind: "zen",
  createdAt: Testing.now,
};

const video = Testing.makeLink({
  id: Link.LinkId.make("seed-1"),
  url: url("https://example.com/videos/economics"),
  title: "A video about economics",
  type: "video",
  tags: [Tag.TagName.make("economics")],
});

const article = Testing.makeLink({
  id: Link.LinkId.make("seed-2"),
  url: url("https://example.com/articles/gardening"),
  title: "Gardening basics",
  type: "article",
  status: "seen",
});

const openTab = {
  url: url("https://example.com/open"),
  title: "Open",
  openedAt: null,
  lastSeenAt: Testing.now,
};

describe("Testing.layer", () => {
  it.effect("saves, gets, updates and lists links", () =>
    Effect.gen(function* () {
      const client = yield* ApiClient.StashApiClient;
      const saved = yield* client.links.save({
        payload: { url: url("https://example.com/new"), title: "New" },
      });
      assert.strictEqual(saved.status, "new");

      const fetched = yield* client.links.get({ params: { id: saved.id } });
      assert.deepStrictEqual(fetched, saved);

      yield* client.links.update({ params: { id: saved.id }, payload: { status: "done" } });
      const done = yield* client.links.list({ query: { status: "done" } });
      assert.deepStrictEqual(
        done.items.map((link) => link.id),
        [saved.id],
      );

      const unseen = yield* client.links.list({ query: { seen: false } });
      assert.deepStrictEqual(
        unseen.items.map((link) => link.id),
        [video.id],
      );

      const page = yield* client.links.list({ query: { limit: 2 } });
      assert.strictEqual(page.items.length, 2);
      const rest = yield* client.links.list({ query: { limit: 2, cursor: page.nextCursor! } });
      assert.strictEqual(rest.items.length, 1);
      assert.isNull(rest.nextCursor);

      const test = yield* Testing.TestApi;
      assert.strictEqual((yield* test.links).length, 3);
    }).pipe(Effect.provide(Testing.layer({ links: [video, article] }))),
  );

  it.effect("fails with NotFound for a missing link", () =>
    Effect.gen(function* () {
      const client = yield* ApiClient.StashApiClient;
      const error = yield* client.links
        .get({ params: { id: Link.LinkId.make("missing") } })
        .pipe(Effect.flip);
      assert.instanceOf(error, Errors.NotFound);
    }).pipe(Effect.provide(Testing.layer())),
  );

  it.effect("searches by keyword and filters", () =>
    Effect.gen(function* () {
      const client = yield* ApiClient.StashApiClient;
      const hits = yield* client.search.search({ query: { q: "ECONOMICS" } });
      assert.deepStrictEqual(
        hits.hits.map((hit) => hit.link.id),
        [video.id],
      );
      const none = yield* client.search.search({ query: { q: "economics", type: "article" } });
      assert.strictEqual(none.hits.length, 0);
    }).pipe(Effect.provide(Testing.layer({ links: [video, article] }))),
  );

  it.effect("lists tabs and archives one, queueing a close-tab command", () =>
    Effect.gen(function* () {
      const client = yield* ApiClient.StashApiClient;

      const all = yield* client.tabs.list();
      assert.deepStrictEqual(all.devices[0]!.snapshot?.tabs, [openTab]);

      const archived = yield* client.tabs.archive({
        payload: { deviceId: zen.id, url: openTab.url },
      });
      assert.strictEqual(archived.link.url, openTab.url);

      const test = yield* Testing.TestApi;
      const commands = yield* test.commands;
      assert.deepStrictEqual(
        commands.map((command) => [command.deviceId, command.payload, command.status]),
        [[zen.id, { kind: "close-tab", url: openTab.url }, "pending"]],
      );
    }).pipe(
      Effect.provide(
        Testing.layer({
          devices: [zen],
          snapshots: [
            {
              deviceId: zen.id,
              takenAt: Testing.now,
              tabs: [openTab],
            },
          ],
        }),
      ),
    ),
  );

  it.effect("answers the latest digest, or NotFound before the first one", () =>
    Effect.gen(function* () {
      const client = yield* ApiClient.StashApiClient;
      const error = yield* client.digest.latest().pipe(Effect.flip);
      assert.instanceOf(error, Errors.NotFound);
    }).pipe(Effect.provide(Testing.layer())),
  );

  it.effect("acts as the user principal", () =>
    Effect.gen(function* () {
      const client = yield* ApiClient.StashApiClient;
      assert.deepStrictEqual(yield* client.auth.me(), { kind: "user" });
    }).pipe(Effect.provide(Testing.layer())),
  );

  it.effect("starts every build from the seed", () =>
    Effect.gen(function* () {
      const client = yield* ApiClient.StashApiClient;
      const page = yield* client.links.list({ query: {} });
      assert.deepStrictEqual(
        page.items.map((link) => link.id),
        [video.id],
      );
    }).pipe(Effect.provide(Testing.layer({ links: [video] }))),
  );
});

describe("Testing.layerFetcher", () => {
  it.effect("rejects a wrong token with Unauthorized", () =>
    Effect.gen(function* () {
      const client = yield* ApiClient.StashApiClient;
      const error = yield* client.links.list({ query: {} }).pipe(Effect.flip);
      assert.instanceOf(error, Errors.Unauthorized);
    }).pipe(
      Effect.provide(
        Layer.unwrap(
          Effect.gen(function* () {
            const API = yield* Testing.FetcherService;
            return ApiClient.layer({ API, API_TOKEN: "wrong-synthetic-token" });
          }),
        ).pipe(Layer.provide(Testing.layerFetcher())),
      ),
    ),
  );
});
