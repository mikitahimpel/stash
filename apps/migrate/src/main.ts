import { NodeHttpClient, NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { Command } from "effect/cli";
import * as ImportCommand from "./import-command.ts";
import * as StashApiClient from "./stash-api-client.ts";

// Entry point: `pnpm --filter @stash/migrate import --zen <file> | --craft <dir> [--dry-run]`.
// Without `--dry-run`, run it through `pp run` so STASH_API_URL and STASH_API_TOKEN are set.

const apiClient = StashApiClient.layerConfig.pipe(Layer.provide(NodeHttpClient.layerUndici));

Command.run(ImportCommand.make(apiClient), { version: "0.0.0" }).pipe(
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain,
);
