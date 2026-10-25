import * as Links from "@stash/contracts-api/links";
import { Config, Console, Effect, FileSystem, Layer, Option, Path } from "effect";
import { CliError, Command, Flag } from "effect/cli";
import * as BatchImporter from "./batch-importer.ts";
import * as CraftExportParser from "./craft-export-parser.ts";
import * as MozLz4 from "./mozlz4.ts";
import type * as StashApiClient from "./stash-api-client.ts";
import * as ZenSessionParser from "./zen-session-parser.ts";

/**
 * `import --zen <file> | --craft <dir> [--dry-run] [--batch-size <n>]`. The api client comes in as
 * a layer and is only built when links are actually sent, so `--dry-run` needs neither env nor
 * network.
 */

const isMozLz4 = (bytes: Uint8Array): boolean =>
  bytes.length >= MozLz4.magic.length && MozLz4.magic.every((byte, i) => bytes[i] === byte);

/** A `recovery.jsonlz4` / `*.baklz4` file, or the same session store as plain JSON. */
const readZen = (file: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const bytes = yield* fs.readFile(file);
    const session = isMozLz4(bytes)
      ? yield* ZenSessionParser.parseMozLz4(bytes)
      : yield* ZenSessionParser.parse(new TextDecoder().decode(bytes));
    return BatchImporter.fromZenSession(session);
  });

const readCraft = (directory: string) =>
  Effect.map(CraftExportParser.parseExport(directory), BatchImporter.fromCraftLinks);

/** `pnpm --filter` runs the script in the package folder; paths are meant relative to the caller. */
const resolveInput = (input: string) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const cwd = yield* Config.String("INIT_CWD").pipe(Config.option);
    return Option.match(cwd, {
      onNone: () => path.resolve(input),
      onSome: (cwd) => path.resolve(cwd, input),
    });
  });

const userError = (error: { readonly message: string }) =>
  new CliError.UserError({ cause: error, userMessage: error.message });

export const make = <E extends { readonly message: string }>(
  apiClient: Layer.Layer<StashApiClient.StashApiClient, E>,
  options: { readonly retry?: BatchImporter.RetryOptions | undefined } = {},
) =>
  Command.make(
    "import",
    {
      zen: Flag.String("zen").pipe(
        Flag.withDescription("Zen session file (recovery.jsonlz4, *.baklz4 or plain JSON)"),
        Flag.optional,
      ),
      craft: Flag.String("craft").pipe(
        Flag.withDescription("Craft Markdown export folder"),
        Flag.optional,
      ),
      dryRun: Flag.Boolean("dry-run").pipe(
        Flag.withDescription("Print counts only; send nothing"),
        Flag.withDefault(false),
      ),
      batchSize: Flag.Int("batch-size").pipe(
        Flag.withDescription(`Links per request (1-${Links.maxBatchSize})`),
        Flag.withDefault(BatchImporter.defaultBatchSize),
      ),
    },
    ({ zen, craft, dryRun, batchSize }) =>
      Effect.gen(function* () {
        const set = yield* Option.isSome(zen)
          ? Effect.flatMap(resolveInput(zen.value), readZen)
          : Effect.flatMap(resolveInput(Option.getOrThrow(craft)), readCraft);
        yield* BatchImporter.printPlan(set, batchSize);
        if (dryRun) {
          yield* Console.log("dry run: nothing sent");
          return;
        }
        const result = yield* BatchImporter.importLinks(set, {
          batchSize,
          retry: options.retry,
        }).pipe(Effect.provide(apiClient));
        yield* Console.log(`done: ${result.saved} saved in ${result.batches} batches`);
      }).pipe(Effect.mapError(userError)),
  ).pipe(
    Command.withDescription("Import links into the stash from a Zen session or a Craft export"),
    Command.validate(({ zen, craft, batchSize }) =>
      Option.isSome(zen) === Option.isSome(craft)
        ? Effect.fail(
            new CliError.ValidationError({ message: "Pass exactly one of --zen or --craft" }),
          )
        : batchSize < 1 || batchSize > Links.maxBatchSize
          ? Effect.fail(
              new CliError.ValidationError({
                message: `--batch-size must be between 1 and ${Links.maxBatchSize}`,
              }),
            )
          : Effect.void,
    ),
  );
