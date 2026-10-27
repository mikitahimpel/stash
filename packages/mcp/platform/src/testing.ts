import * as Api from "@stash/contracts-api/api";
import * as Security from "@stash/contracts-api/security";
import * as Command from "@stash/contracts-domain/command";
import * as Device from "@stash/contracts-domain/device";
import * as Digest from "@stash/contracts-domain/digest";
import * as Errors from "@stash/contracts-domain/errors";
import * as Link from "@stash/contracts-domain/link";
import * as Tab from "@stash/contracts-domain/tab";
import type * as Tag from "@stash/contracts-domain/tag";
import { Context, DateTime, Effect, Layer, Option, Redacted } from "effect";
import { HttpRouter, HttpServer } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import * as ApiClient from "./api-client.ts";

// A fake `apps/api`: the real `StashApi` served by in-memory handlers, reached through a fake
// Service Binding. Requests take the same path as in production (HttpApiClient → binding `fetch`
// → HTTP router), so tools are tested against the real wire format. All data is synthetic.

/** Synthetic placeholder for `API_TOKEN`, not a real token. The fake api accepts only this one. */
export const apiToken = "synthetic-mcp-token";

/** The clock of the fake api: every link and command it creates has this timestamp. */
export const now = DateTime.makeUnsafe("2026-01-02T03:04:05.000Z");

/** What the fake api starts with. Everything is empty by default. */
export interface Seed {
  readonly links?: ReadonlyArray<Link.Link>;
  readonly devices?: ReadonlyArray<Device.Device>;
  readonly snapshots?: ReadonlyArray<Tab.TabsSnapshot>;
  readonly digest?: Digest.Digest;
}

/** Test controls: read what tools changed in the fake api. */
export class TestApi extends Context.Service<
  TestApi,
  {
    readonly links: Effect.Effect<ReadonlyArray<Link.Link>>;
    readonly commands: Effect.Effect<ReadonlyArray<Command.Command>>;
  }
>()("@stash/mcp-platform/TestApi") {}

interface State {
  readonly links: Map<Link.LinkId, Link.Link>;
  readonly devices: Map<Device.DeviceId, Device.Device>;
  readonly snapshots: Map<Device.DeviceId, Tab.TabsSnapshot>;
  readonly commands: Map<Command.CommandId, Command.Command>;
  digest: Digest.Digest | undefined;
}

const makeState = (seed: Seed): State => ({
  links: new Map(seed.links?.map((link) => [link.id, link])),
  devices: new Map(seed.devices?.map((device) => [device.id, device])),
  snapshots: new Map(seed.snapshots?.map((snapshot) => [snapshot.deviceId, snapshot])),
  commands: new Map(),
  digest: seed.digest,
});

/** A synthetic link with every optional field empty. Override fields as needed. */
export const makeLink = (
  fields: Pick<Link.Link, "id" | "url"> & Partial<Link.Link>,
): Link.Link => ({
  canonicalUrl: null,
  title: null,
  status: "new",
  type: null,
  summary: null,
  language: null,
  tags: [],
  sourceDeviceId: null,
  createdAt: now,
  enrichedAt: null,
  ...fields,
});

const notFound = (resource: string, id: string) => new Errors.NotFound({ resource, id });

const findIn = <K extends string, V>(map: Map<K, V>, resource: string, id: K) =>
  Option.fromNullishOr(map.get(id)).pipe(
    Effect.fromOption,
    Effect.mapError(() => notFound(resource, id)),
  );

/** The MCP server acts as the signed-in user, so the fake api maps its token to a user. */
const AuthorizationStub = Layer.succeed(
  Security.Authorization,
  Security.Authorization.of({
    bearer: (handler, { credential }) =>
      Redacted.value(credential) === apiToken
        ? Effect.provideService(handler, Security.CurrentPrincipal, { kind: "user" })
        : Effect.fail(new Errors.Unauthorized({ message: "Invalid token" })),
    session: () => Effect.fail(new Errors.Unauthorized({ message: "No session" })),
  }),
);

// Endpoints the MCP server has no use for. Calling one is a bug in the test or the tool.
const unsupported = (endpoint: string) =>
  Effect.die(new Error(`The fake api does not implement ${endpoint}`));

const groups = (state: State) => {
  const store = (link: Link.Link) => {
    state.links.set(link.id, link);
    return link;
  };
  const save = (input: Link.SaveLinkInput) =>
    store(
      makeLink({
        id: Link.LinkId.make(`link-${state.links.size + 1}`),
        url: input.url,
        title: input.title ?? null,
        tags: input.tags ?? [],
      }),
    );
  const queue = (deviceId: Device.DeviceId, payload: Command.CommandPayload) => {
    const command: Command.Command = {
      id: Command.CommandId.make(`command-${state.commands.size + 1}`),
      deviceId,
      payload,
      status: "pending",
      createdAt: now,
      completedAt: null,
    };
    state.commands.set(command.id, command);
    return command;
  };
  const matches = (
    link: Link.Link,
    query: { readonly type?: Link.LinkType; readonly tag?: Tag.TagName },
  ) =>
    (query.type === undefined || link.type === query.type) &&
    (query.tag === undefined || link.tags.includes(query.tag));

  const links = HttpApiBuilder.group(Api.StashApi, "links", (handlers) =>
    handlers
      .handle("save", ({ payload }) => Effect.sync(() => save(payload)))
      .handle("saveBatch", ({ payload }) => Effect.sync(() => ({ links: payload.links.map(save) })))
      .handle("list", ({ query }) =>
        Effect.sync(() => {
          const all = [...state.links.values()].filter(
            (link) =>
              matches(link, query) &&
              (query.status === undefined || link.status === query.status) &&
              (query.seen === undefined || (link.status !== "new") === query.seen),
          );
          const start = query.cursor === undefined ? 0 : Number(query.cursor);
          const end = start + (query.limit ?? 20);
          return {
            items: all.slice(start, end),
            nextCursor: end < all.length ? String(end) : null,
          };
        }),
      )
      .handle("get", ({ params }) => findIn(state.links, "link", params.id))
      .handle("update", ({ params, payload }) =>
        Effect.map(findIn(state.links, "link", params.id), (link) =>
          store({ ...link, ...payload }),
        ),
      )
      .handle("remove", ({ params }) =>
        Effect.map(findIn(state.links, "link", params.id), (link) => {
          state.links.delete(link.id);
        }),
      ),
  );

  // Keyword match on title, URL and summary. Earlier links rank higher.
  const search = HttpApiBuilder.group(Api.StashApi, "search", (handlers) =>
    handlers.handle("search", ({ query }) =>
      Effect.sync(() => {
        const q = query.q.toLowerCase();
        const hits = [...state.links.values()]
          .filter(
            (link) =>
              matches(link, query) &&
              [link.title, link.url, link.summary].some((text) => text?.toLowerCase().includes(q)),
          )
          .map((link, index, all) => ({ link, score: all.length - index }));
        return { hits };
      }),
    ),
  );

  const tabs = HttpApiBuilder.group(Api.StashApi, "tabs", (handlers) =>
    handlers
      .handle("report", ({ params, payload }) =>
        Effect.map(findIn(state.devices, "device", params.id), (device) => {
          state.snapshots.set(device.id, { deviceId: device.id, ...payload });
        }),
      )
      .handle("list", () =>
        Effect.sync(() => ({
          devices: [...state.devices.values()].map((device) => ({
            device,
            snapshot: state.snapshots.get(device.id) ?? null,
          })),
        })),
      )
      .handle("archive", ({ payload }) =>
        Effect.map(findIn(state.devices, "device", payload.deviceId), (device) => ({
          link: save(
            payload.title === undefined
              ? { url: payload.url }
              : { url: payload.url, title: payload.title },
          ),
          command: queue(device.id, { kind: "close-tab", url: payload.url }),
        })),
      ),
  );

  const devices = HttpApiBuilder.group(Api.StashApi, "devices", (handlers) =>
    handlers
      .handle("list", () => Effect.sync(() => [...state.devices.values()]))
      .handle("register", () => unsupported("devices.register"))
      .handle("sendCommand", ({ params, payload }) =>
        Effect.map(findIn(state.devices, "device", params.id), (device) =>
          queue(device.id, payload),
        ),
      )
      .handle("listCommands", ({ params, query }) =>
        Effect.map(findIn(state.devices, "device", params.id), (device) =>
          [...state.commands.values()].filter(
            (command) =>
              command.deviceId === device.id &&
              (query.status === undefined || command.status === query.status),
          ),
        ),
      )
      .handle("ackCommand", () => unsupported("devices.ackCommand")),
  );

  const tokens = HttpApiBuilder.group(Api.StashApi, "tokens", (handlers) =>
    handlers
      .handle("list", () => unsupported("tokens.list"))
      .handle("create", () => unsupported("tokens.create"))
      .handle("revoke", () => unsupported("tokens.revoke")),
  );

  const auth = HttpApiBuilder.group(Api.StashApi, "auth", (handlers) =>
    handlers
      .handle("me", () =>
        Effect.gen(function* () {
          return yield* Security.CurrentPrincipal;
        }),
      )
      .handle("deviceStart", () => unsupported("auth.deviceStart"))
      .handle("devicePoll", () => unsupported("auth.devicePoll"))
      .handle("logout", () => unsupported("auth.logout")),
  );

  const digest = HttpApiBuilder.group(Api.StashApi, "digest", (handlers) =>
    handlers.handle("latest", () =>
      state.digest === undefined
        ? Effect.fail(notFound("digest", "latest"))
        : Effect.succeed(state.digest),
    ),
  );

  return Layer.mergeAll(links, search, tabs, devices, tokens, auth, digest);
};

/** A Service Binding whose `fetch` is answered by `handler` in-process. */
const makeFetcher = (handler: (request: Request) => Promise<Response>): Fetcher => ({
  fetch: (input, init) => handler(new Request(input, init)),
  connect: () => {
    throw new Error("The fake api binding does not support connect()");
  },
});

/** The fake api as a Service Binding. Pair it with `ApiClient.layer` to test custom wiring. */
export const layerFetcher = (seed: Seed = {}): Layer.Layer<FetcherService | TestApi> =>
  Layer.effectContext(
    Effect.gen(function* () {
      const state = makeState(seed);
      const app = HttpApiBuilder.layer(Api.StashApi).pipe(
        Layer.provide(groups(state)),
        Layer.provide(AuthorizationStub),
        Layer.provide(HttpServer.layerServices),
      );
      const web = yield* Effect.acquireRelease(
        Effect.sync(() => HttpRouter.toWebHandler(app, { disableLogger: true })),
        (web) => Effect.promise(() => web.dispose()),
      );
      return Context.make(FetcherService, makeFetcher(web.handler)).pipe(
        Context.add(TestApi, {
          links: Effect.sync(() => [...state.links.values()]),
          commands: Effect.sync(() => [...state.commands.values()]),
        }),
      );
    }),
  );

/** The fake api binding provided by `layerFetcher`. */
export class FetcherService extends Context.Service<FetcherService, Fetcher>()(
  "@stash/mcp-platform/testing/Fetcher",
) {}

/**
 * `StashApiClient` backed by the fake api, plus `TestApi` controls. Each build starts from `seed`,
 * so every test that provides the layer gets its own data.
 */
export const layer = (seed: Seed = {}): Layer.Layer<ApiClient.StashApiClient | TestApi> =>
  Layer.unwrap(
    Effect.gen(function* () {
      const API = yield* FetcherService;
      return ApiClient.layer({ API, API_TOKEN: apiToken });
    }),
  ).pipe(Layer.provideMerge(layerFetcher(seed)));
