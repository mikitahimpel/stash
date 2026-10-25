import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import * as Links from "@stash/contracts-api/links";
import { Context, Effect, FileSystem, Layer } from "effect";
import { Command } from "effect/cli";
import { TestConsole } from "effect/testing";
import * as BatchImporter from "../src/batch-importer.ts";
import * as ImportCommand from "../src/import-command.ts";
import type * as StashApiClient from "../src/stash-api-client.ts";
import * as Encode from "./mozlz4-encode.ts";
import * as Stub from "./stash-api-stub.ts";

const zenFixture = `${import.meta.dirname}/fixtures/zen-session.synthetic.json`;
const craftFixture = `${import.meta.dirname}/fixtures/craft-export.synthetic`;

const zenUrls = [
  "https://example.com/docs/guide",
  "https://example.org/articles/economics-video",
  "https://example.net/second",
  "https://example.net/no-workspace",
];

// No waiting in tests: retries back off from 1 ms, and the stub's rate limit asks for 0 s.
const retry: BatchImporter.RetryOptions = { times: 3, baseDelay: "1 millis" };

/** A client layer that fails the test if anything builds it, so nothing can reach the network. */
const noClient: Layer.Layer<StashApiClient.StashApiClient, { readonly message: string }> =
  Layer.effectDiscard(Effect.die(new Error("--dry-run must not build the api client"))) as never;

const run = <E extends { readonly message: string }>(
  args: ReadonlyArray<string>,
  apiClient: Layer.Layer<StashApiClient.StashApiClient, E>,
) =>
  Command.runWith(ImportCommand.make(apiClient, { retry }), { version: "0.0.0" })(args).pipe(
    Effect.provide(NodeServices.layer),
  );

/** Runs `f` against a fresh stub api: `client` for the command, `api` to inspect the stub. */
const withStub = <A, E>(
  options: Parameters<typeof Stub.layer>[0],
  f: (
    client: Layer.Layer<StashApiClient.StashApiClient>,
    api: Stub.StubApi["Service"],
  ) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    const context = yield* Layer.build(Stub.layer(options));
    return yield* f(Layer.succeedContext(context), Context.get(context, Stub.StubApi));
  }).pipe(Effect.scoped);

const output = Effect.map(TestConsole.logLines, (lines) => lines.join("\n"));

describe("collect", () => {
  it("dedupes by URL, drops invalid URLs and keeps the first title", () => {
    const set = BatchImporter.collect([
      { url: "https://example.com/a", title: null },
      { url: "https://example.com/b", title: "  B  " },
      { url: "https://example.com/a", title: "A, found later" },
      { url: "https://example.com/b", title: "B again" },
      { url: "about:blank", title: "Not a link" },
      { url: "file:///tmp/x", title: null },
      { url: "https://example.com/c", title: "x".repeat(1200) },
    ]);
    expect(set.duplicates).toBe(2);
    expect(set.invalid).toBe(2);
    expect(set.links).toEqual([
      { url: "https://example.com/a", title: "A, found later" },
      { url: "https://example.com/b", title: "B" },
      { url: "https://example.com/c", title: "x".repeat(1000) },
    ]);
  });
});

describe("toBatches", () => {
  const links = BatchImporter.collect(
    Array.from({ length: 5 }, (_, i) => ({ url: `https://example.com/${i}`, title: null })),
  ).links;

  it("chunks links, the last batch carrying the rest", () => {
    expect(BatchImporter.toBatches(links, 2).map((batch) => batch.length)).toEqual([2, 2, 1]);
  });

  it("clamps the batch size to what the api accepts", () => {
    expect(BatchImporter.toBatches(links, 0)).toHaveLength(5);
    const many = BatchImporter.collect(
      Array.from({ length: Links.maxBatchSize + 1 }, (_, i) => ({
        url: `https://example.com/${i}`,
        title: null,
      })),
    ).links;
    expect(BatchImporter.toBatches(many, 10_000).map((batch) => batch.length)).toEqual([
      Links.maxBatchSize,
      1,
    ]);
  });
});

describe("--dry-run", () => {
  it.effect("prints counts for a Zen session without network", () =>
    Effect.gen(function* () {
      yield* run(["--zen", zenFixture, "--dry-run", "--batch-size", "3"], noClient);
      expect(yield* output).toBe(
        [
          "links: 4",
          "duplicates skipped: 0",
          "invalid skipped: 0",
          "batches: 2",
          "dry run: nothing sent",
        ].join("\n"),
      );
    }),
  );

  it.effect("prints counts for a Craft export without network", () =>
    Effect.gen(function* () {
      yield* run(["--craft", craftFixture, "--dry-run"], noClient);
      expect(yield* output).toBe(
        [
          "links: 8",
          "duplicates skipped: 0",
          "invalid skipped: 0",
          "batches: 1",
          "dry run: nothing sent",
        ].join("\n"),
      );
    }),
  );

  it.effect("reads a jsonlz4 session too", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped();
      const file = `${dir}/recovery.jsonlz4`;
      const json: unknown = JSON.parse(yield* fs.readFileString(zenFixture));
      yield* fs.writeFile(file, Encode.encodeJson(json));
      yield* run(["--zen", file, "--dry-run"], noClient);
      expect(yield* output).toContain("links: 4");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

describe("import", () => {
  it.effect("posts every link in batches", () =>
    withStub({}, (client, api) =>
      Effect.gen(function* () {
        yield* run(["--zen", zenFixture, "--batch-size", "3"], client);
        expect(yield* api.calls).toEqual([3, 1]);
        expect((yield* api.links).map((link) => link.url)).toEqual(zenUrls);
        expect(yield* output).toContain("batch 1/2: 3 saved\nbatch 2/2: 1 saved\ndone: 4 saved");
      }),
    ),
  );

  it.effect("is resume-safe: a rerun stores nothing twice", () =>
    withStub({}, (client, api) =>
      Effect.gen(function* () {
        yield* run(["--zen", zenFixture, "--batch-size", "2"], client);
        yield* run(["--zen", zenFixture, "--batch-size", "2"], client);
        expect(yield* api.calls).toEqual([2, 2, 2, 2]);
        expect(yield* api.links).toHaveLength(4);
      }),
    ),
  );

  it.live("retries rate limits and server errors", () =>
    withStub({ answers: ["rate-limited", "server-error", "ok", "rate-limited"] }, (client, api) =>
      Effect.gen(function* () {
        yield* run(["--zen", zenFixture, "--batch-size", "2"], client);
        expect(yield* api.calls).toEqual([2, 2, 2, 2, 2]);
        expect(yield* api.links).toHaveLength(4);
      }),
    ).pipe(Effect.provide(TestConsole.layer)),
  );

  it.live("gives up after the retries and says how to resume", () =>
    withStub(
      { answers: ["ok", "server-error", "server-error", "server-error", "server-error"] },
      (client, api) =>
        Effect.gen(function* () {
          const error = yield* run(["--zen", zenFixture, "--batch-size", "2"], client).pipe(
            Effect.flip,
          );
          expect(yield* api.calls).toEqual([2, 2, 2, 2, 2]);
          expect(yield* api.links).toHaveLength(2);
          expect(error.message).toContain("batch 2/2 failed");
          expect(error.message).toContain("rerun the import to resume");
        }),
    ).pipe(Effect.provide(TestConsole.layer)),
  );

  it.effect("does not retry a rejected token", () =>
    withStub({ token: "wrong-synthetic-token" }, (client, api) =>
      Effect.gen(function* () {
        const error = yield* run(["--zen", zenFixture], client).pipe(Effect.flip);
        expect(yield* api.calls).toEqual([]);
        expect(error.message).toContain("Unauthorized");
      }),
    ),
  );
});

describe("flags", () => {
  it.effect("needs exactly one source", () =>
    Effect.gen(function* () {
      const error = yield* run(
        ["--zen", zenFixture, "--craft", craftFixture, "--dry-run"],
        noClient,
      ).pipe(Effect.flip);
      expect(error._tag).toBe("ShowHelp");
      const errors = yield* TestConsole.errorLines;
      expect(errors.join("\n")).toContain("Pass exactly one of --zen or --craft");
    }),
  );
});
