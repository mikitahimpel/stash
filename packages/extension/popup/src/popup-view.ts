import * as Link from "@stash/contracts-domain/link";
import * as Tabs from "@stash/ext-platform/browser-tabs";
import * as ExtensionConfig from "@stash/ext-platform/extension-config";
import * as StashApiClient from "@stash/ext-platform/stash-api-client";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as PopupLink from "./popup-link.ts";

/** How many of the latest saved links the popup lists. */
export const recentCount = 5;

/** The tab the popup was opened on. */
export interface Page {
  /** `null` when the browser withholds it (privileged pages). */
  readonly url: string | null;
  /** The tab's title, or its host, or a placeholder. */
  readonly title: string;
  /** Empty when there is no URL. */
  readonly host: string;
  readonly favIconUrl: string | null;
  /** Only http(s) pages can be saved. */
  readonly savable: boolean;
}

/**
 * How the extension stands with Stash:
 * - `NotPaired`: no device token yet, or the api rejected it. The popup offers to connect.
 * - `Connected`: the api answered. `deviceName` is the device this browser acts as, or `null`
 *   for a token that belongs to no device (one entered by hand).
 * - `Unreachable`: there is a token, but the api did not answer.
 */
export type Connection =
  | { readonly _tag: "NotPaired" }
  | { readonly _tag: "Connected"; readonly deviceName: string | null; readonly webOrigin: string }
  | { readonly _tag: "Unreachable"; readonly webOrigin: string };

/** Everything the popup shows besides the page itself. */
export interface View {
  readonly connection: Connection;
  /** The stored link of the current page, if it is in Stash already. */
  readonly saved: PopupLink.PopupLink | null;
  /** The latest saved links, newest first. */
  readonly recent: ReadonlyArray<PopupLink.PopupLink>;
}

const decodeUrl = Schema.decodeUnknownOption(Link.Url);

const toPage = (tab: Tabs.Tab): Page => {
  const host = tab.url === null ? "" : PopupLink.host(tab.url);
  return {
    url: tab.url,
    title: tab.title?.trim() || host || "This page",
    host,
    favIconUrl: tab.favIconUrl,
    savable: Option.isSome(decodeUrl(tab.url)),
  };
};

/** The active tab of the current window. Local, so the popup can show it at once. */
export const currentPage: Effect.Effect<Page | null, never, Tabs.Tabs> = Effect.flatMap(
  Tabs.Tabs,
  (tabs) => tabs.current,
).pipe(
  Effect.map(Option.match({ onNone: () => null, onSome: toPage })),
  Effect.orElseSucceed(() => null),
);

/**
 * The web app's origin. The api is served under `/api` of the web app, so it is the origin of the
 * api base URL. The options page keeps its own copy of this rule.
 */
export const webOrigin = (apiBaseUrl: URL): string => apiBaseUrl.origin;

const notPaired: View = { connection: { _tag: "NotPaired" }, saved: null, recent: [] };

// The device this token belongs to, by name. Only a rejected token fails: anything else that goes
// wrong here just leaves the name out.
const deviceName = Effect.gen(function* () {
  const client = yield* StashApiClient.StashApiClient;
  const principal = yield* client.auth.me();
  if (principal.kind !== "device") return null;
  const devices = yield* client.devices.list();
  return devices.find((device) => device.id === principal.deviceId)?.name ?? null;
}).pipe(
  Effect.catch((error) =>
    error._tag === "Unauthorized" ? Effect.fail(error) : Effect.succeed(null),
  ),
);

const savedLink = Effect.gen(function* () {
  const tabs = yield* Tabs.Tabs;
  const url = Option.flatMap(
    yield* tabs.current.pipe(Effect.orElseSucceed(() => Option.none<Tabs.Tab>())),
    (tab) => decodeUrl(tab.url),
  );
  if (Option.isNone(url)) return null;
  const client = yield* StashApiClient.StashApiClient;
  const page = yield* client.links.list({ query: { url: url.value, limit: 1 } });
  return page.items[0] === undefined ? null : PopupLink.fromLink(page.items[0]);
});

const recentLinks = Effect.gen(function* () {
  const client = yield* StashApiClient.StashApiClient;
  const page = yield* client.links.list({ query: { sort: "recent", limit: recentCount } });
  return page.items.map(PopupLink.fromLink);
});

/**
 * The popup's view of Stash: who this browser is connected as, whether the current page is saved
 * (`GET /links?url=…`) and the latest saved links. Never fails: without a working token the view
 * is `NotPaired`, and when the api does not answer it is `Unreachable`.
 */
export const load: Effect.Effect<
  View,
  never,
  Tabs.Tabs | ExtensionConfig.ExtensionConfig | StashApiClient.StashApiClient
> = Effect.gen(function* () {
  const config = yield* (yield* ExtensionConfig.ExtensionConfig).get;
  const origin = webOrigin(config.apiBaseUrl);
  return yield* Effect.all([deviceName, savedLink, recentLinks], { concurrency: "unbounded" }).pipe(
    Effect.map(([name, saved, recent]): View => ({
      connection: { _tag: "Connected", deviceName: name, webOrigin: origin },
      saved,
      recent,
    })),
    Effect.catch((error) =>
      Effect.succeed<View>(
        error._tag === "Unauthorized" || error._tag === "ConfigError"
          ? notPaired
          : { connection: { _tag: "Unreachable", webOrigin: origin }, saved: null, recent: [] },
      ),
    ),
  );
}).pipe(Effect.orElseSucceed(() => notPaired));
