import * as Api from "@stash/contracts-api/api";
import * as InternalApi from "@stash/contracts-api/internal-api";
import * as ApiToken from "@stash/contracts-domain/api-token";
import * as Security from "@stash/contracts-api/security";
import * as Command from "@stash/contracts-domain/command";
import * as Device from "@stash/contracts-domain/device";
import * as Digest from "@stash/contracts-domain/digest";
import * as Errors from "@stash/contracts-domain/errors";
import * as Link from "@stash/contracts-domain/link";
import * as Tab from "@stash/contracts-domain/tab";
import type * as Tag from "@stash/contracts-domain/tag";
import * as User from "@stash/contracts-domain/user";
import { Context, DateTime, Effect, Layer, Option, Redacted } from "effect";
import { HttpRouter, HttpServer } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import * as ApiClient from "./api-client.ts";

// A fake `apps/api`: the real `StashApi` served by in-memory handlers, reached through a fake
// Service Binding. Requests take the same path as in production (HttpApiClient → binding `fetch`
// → HTTP router), so tools are tested against the real wire format. All data is synthetic.

/**
 * Synthetic api token, not a real one. The fake api accepts it from the start, and `layer` sends it
 * when a request provides no `GrantApiToken`. Tokens minted through `/internal/mcp-tokens` are
 * accepted too, until revoked.
 */
export const apiToken = "synthetic-mcp-token";

/** The user every token of the fake api acts for. */
export const userId = User.UserId.make("owner");

/** The numeric id (as text) of the GitHub account `allowedLogin`. */
export const allowedGithubId = "1001";

/** The only login the fake api's `/internal/mcp-tokens` mints a token for. */
export const allowedLogin = "synthetic-user";

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
    /** Every token minted through `/internal/mcp-tokens`, in order, with the login it is for. */
    readonly mintedTokens: Effect.Effect<
      ReadonlyArray<{ readonly token: string; readonly login: string }>
    >;
    /** The tokens the fake api accepts now. */
    readonly activeTokens: Effect.Effect<ReadonlyArray<string>>;
    /** Revokes a token, as Settings does: the fake api then answers it with 401. */
    readonly revokeToken: (token: string) => Effect.Effect<void>;
  }
>()("@stash/mcp-platform/TestApi") {}

interface State {
  readonly links: Map<Link.LinkId, Link.Link>;
  readonly devices: Map<Device.DeviceId, Device.Device>;
  readonly snapshots: Map<Device.DeviceId, Tab.TabsSnapshot>;
  readonly commands: Map<Command.CommandId, Command.Command>;
  digest: Digest.Digest | undefined;
  /** Tokens the fake api accepts. */
  readonly activeTokens: Set<string>;
  readonly minted: Array<{ readonly token: string; readonly login: string }>;
}

const makeState = (seed: Seed): State => ({
  links: new Map(seed.links?.map((link) => [link.id, link])),
  devices: new Map(seed.devices?.map((device) => [device.id, device])),
  snapshots: new Map(seed.snapshots?.map((snapshot) => [snapshot.deviceId, snapshot])),
  commands: new Map(),
  digest: seed.digest,
  activeTokens: new Set([apiToken]),
  minted: [],
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
  imageUrl: null,
  author: null,
  enrichedAt: null,
  ...fields,
});

const notFound = (resource: string, id: string) => new Errors.NotFound({ resource, id });

const findIn = <K extends string, V>(map: Map<K, V>, resource: string, id: K) =>
  Option.fromNullishOr(map.get(id)).pipe(
    Effect.fromOption,
    Effect.mapError(() => notFound(resource, id)),
  );

/** The MCP server acts as the signed-in user, so the fake api maps its tokens to a user. */
const authorizationStub = (state: State) =>
  Layer.succeed(
    Security.Authorization,
    Security.Authorization.of({
      bearer: (handler, { credential }) =>
        state.activeTokens.has(Redacted.value(credential))
          ? handler.pipe(
              Effect.provideService(Security.CurrentPrincipal, { kind: "user" }),
              Effect.provideService(Security.CurrentUser, { id: userId, role: "owner" }),
            )
          : Effect.fail(new Errors.Unauthorized({ message: "Invalid token" })),
      session: () => Effect.fail(new Errors.Unauthorized({ message: "No session" })),
    }),
  );

/** `POST /internal/mcp-tokens`, served on the same fake binding as the `StashApi`. */
const internalGroup = (state: State) =>
  HttpApiBuilder.group(InternalApi.InternalApi, "internal", (handlers) =>
    handlers
      .handle("createMcpToken", ({ payload }) => {
        if (payload.login.toLowerCase() !== allowedLogin) {
          return Effect.fail(
            new Errors.LoginNotAllowed({ message: "This GitHub login is not allowed" }),
          );
        }
        return Effect.sync(() => {
          const token = `synthetic-minted-token-${state.minted.length + 1}`;
          state.minted.push({ token, login: payload.login });
          state.activeTokens.add(token);
          return {
            id: ApiToken.ApiTokenId.make(`token-${state.minted.length}`),
            deviceId: null,
            name: ApiToken.mcpTokenName,
            createdAt: now,
            revokedAt: null,
            token: Redacted.make(token),
          };
        });
      })
      .handle("createMcpTokenForSession", ({ payload }) => {
        if (payload.session !== webSession) {
          return Effect.fail(new Errors.Unauthorized({ message: "Unknown session" }));
        }
        return Effect.sync(() => {
          const token = `synthetic-minted-token-${state.minted.length + 1}`;
          state.minted.push({ token, login: "" });
          state.activeTokens.add(token);
          return {
            id: ApiToken.ApiTokenId.make(`token-${state.minted.length}`),
            deviceId: null,
            name: ApiToken.mcpTokenName,
            createdAt: now,
            revokedAt: null,
            token: Redacted.make(token),
            userId,
          };
        });
      }),
  );

/** The `stash_session` cookie of the fake api's one web session (the owner's). */
export const webSession = "synthetic-web-session";

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
      .handle("save", ({ payload }) => Effect.sync(() => ({ ...save(payload), created: true })))
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
      .handle("activity", () => unsupported("devices.activity"))
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
      .handle("revoke", ({ params }) =>
        Effect.gen(function* () {
          const minted = state.minted[Number(params.id.replace(/^token-/, "")) - 1];
          if (minted === undefined || !state.activeTokens.has(minted.token)) {
            return yield* new Errors.NotFound({ resource: "token", id: params.id });
          }
          state.activeTokens.delete(minted.token);
        }),
      ),
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

  const pairings = HttpApiBuilder.group(Api.StashApi, "pairings", (handlers) =>
    handlers
      .handle("approve", () => unsupported("pairings.approve"))
      .handle("claim", () => unsupported("pairings.claim")),
  );

  const connect = HttpApiBuilder.group(Api.StashApi, "connect", (handlers) =>
    handlers.handle("info", () => unsupported("connect.info")),
  );

  const events = HttpApiBuilder.group(Api.StashApi, "events", (handlers) =>
    handlers.handle("stream", () => unsupported("events.stream")),
  );

  // The MCP tools manage neither members nor invites.
  const members = HttpApiBuilder.group(Api.StashApi, "members", (handlers) =>
    handlers
      .handle("me", () => unsupported("members.me"))
      .handle("list", () => unsupported("members.list"))
      .handle("remove", () => unsupported("members.remove")),
  );

  const invites = HttpApiBuilder.group(Api.StashApi, "invites", (handlers) =>
    handlers
      .handle("list", () => unsupported("invites.list"))
      .handle("create", () => unsupported("invites.create"))
      .handle("revoke", () => unsupported("invites.revoke"))
      .handle("check", () => unsupported("invites.check")),
  );

  // Signing in happens in the web app; the MCP server only reads the session it leaves.
  const signIn = HttpApiBuilder.group(Api.StashApi, "signIn", (handlers) =>
    handlers
      .handle("providers", () => unsupported("signIn.providers"))
      .handle("passkeyOptions", () => unsupported("signIn.passkeyOptions"))
      .handle("passkeySignIn", () => unsupported("signIn.passkeySignIn"))
      .handle("passkeySignUpOptions", () => unsupported("signIn.passkeySignUpOptions"))
      .handle("passkeySignUp", () => unsupported("signIn.passkeySignUp"))
      .handle("googleStart", () => unsupported("signIn.googleStart"))
      .handle("googleCallback", () => unsupported("signIn.googleCallback"))
      .handle("methods", () => unsupported("signIn.methods"))
      .handle("passkeyAddOptions", () => unsupported("signIn.passkeyAddOptions"))
      .handle("passkeyAdd", () => unsupported("signIn.passkeyAdd"))
      .handle("passkeyRemove", () => unsupported("signIn.passkeyRemove"))
      .handle("googleLink", () => unsupported("signIn.googleLink"))
      .handle("githubLink", () => unsupported("signIn.githubLink"))
      .handle("accountRemove", () => unsupported("signIn.accountRemove")),
  );

  return Layer.mergeAll(
    links,
    search,
    tabs,
    devices,
    tokens,
    auth,
    digest,
    pairings,
    connect,
    events,
    members,
    invites,
    signIn,
  );
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
      const app = Layer.mergeAll(
        HttpApiBuilder.layer(Api.StashApi).pipe(
          Layer.provide(groups(state)),
          Layer.provide(authorizationStub(state)),
        ),
        HttpApiBuilder.layer(InternalApi.InternalApi).pipe(Layer.provide(internalGroup(state))),
      ).pipe(Layer.provide(HttpServer.layerServices));
      const web = yield* Effect.acquireRelease(
        Effect.sync(() => HttpRouter.toWebHandler(app, { disableLogger: true })),
        (web) => Effect.promise(() => web.dispose()),
      );
      return Context.make(FetcherService, makeFetcher(web.handler)).pipe(
        Context.add(TestApi, {
          links: Effect.sync(() => [...state.links.values()]),
          commands: Effect.sync(() => [...state.commands.values()]),
          mintedTokens: Effect.sync(() => [...state.minted]),
          activeTokens: Effect.sync(() => [...state.activeTokens]),
          revokeToken: (token) =>
            Effect.sync(() => {
              state.activeTokens.delete(token);
            }),
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
      return ApiClient.layer({ API }, { token: Redacted.make(apiToken) });
    }),
  ).pipe(Layer.provideMerge(layerFetcher(seed)));
