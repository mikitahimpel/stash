import * as FetchHttpClient from "effect/http/FetchHttpClient";
import type * as HttpClient from "effect/http/HttpClient";
import * as Layer from "effect/Layer";
import * as ExtensionConfig from "./extension-config.ts";
import * as StashApiClient from "./stash-api-client.ts";
import * as ToolbarAction from "./browser-action.ts";
import * as Alarms from "./browser-alarms.ts";
import * as Commands from "./browser-commands.ts";
import * as Storage from "./browser-storage.ts";
import * as Tabs from "./browser-tabs.ts";
import * as Windows from "./browser-windows.ts";
import * as Workspaces from "./browser-workspaces.ts";

/**
 * Every extension platform service, provided by the browser. `apps/extension` provides this
 * layer in each entrypoint. The manifest needs the `tabs`, `storage` and `alarms` permissions,
 * host permission for the API origin and a toolbar button (`browser_action`).
 *
 * - `Tabs`, `Windows`, `Storage`, `Alarms`, `Commands`, `Workspaces`, `ToolbarAction`:
 *   `browser.*`.
 * - `HttpClient` (`effect/http/HttpClient`): backed by `fetch`.
 * - `ExtensionConfig`, `StashApiClient`: built on `Storage` and `HttpClient`.
 */
export type Services =
  | Tabs.Tabs
  | Windows.Windows
  | Storage.Storage
  | Alarms.Alarms
  | Commands.Commands
  | Workspaces.Workspaces
  | ToolbarAction.ToolbarAction
  | HttpClient.HttpClient
  | ExtensionConfig.ExtensionConfig
  | StashApiClient.StashApiClient;

export const layerHttpClient: Layer.Layer<HttpClient.HttpClient> = FetchHttpClient.layer;

const browserLayer = Layer.mergeAll(
  Tabs.layer,
  Windows.layer,
  Storage.layer,
  Alarms.layer,
  Commands.layer,
  Workspaces.layer,
  ToolbarAction.layer,
  layerHttpClient,
);

export const layer: Layer.Layer<Services> = StashApiClient.layer.pipe(
  Layer.provideMerge(ExtensionConfig.layer),
  Layer.provideMerge(browserLayer),
);
