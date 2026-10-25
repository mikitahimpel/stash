// Infrastructure for Stash, declared with Alchemy v2 (beta). See docs/alchemy.md.
//
// Nothing personal lives here: physical names are derived from the stack, the stage
// (`--stage` or ALCHEMY_STAGE) and the logical ids below, and the Cloudflare account comes
// from CLOUDFLARE_ACCOUNT_ID or the Alchemy profile, used only by `alchemy deploy`.
// `alchemy dev` emulates every resource here locally and needs no credentials.
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as State from "alchemy/State";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";

export const Database = Cloudflare.D1.Database("Database");

export const EnrichmentQueue = Cloudflare.Queues.Queue("EnrichmentQueue");

export default Alchemy.Stack(
  "stash",
  {
    providers: Cloudflare.providers(),
    // State stays on disk in the gitignored `.alchemy/` folder.
    state: State.localState(),
  },
  Effect.gen(function* () {
    const port = yield* Config.Port("STASH_API_PORT").pipe(Config.withDefault(8787));
    const host = yield* Config.String("STASH_API_HOST").pipe(Config.withDefault("0.0.0.0"));
    // The `/_smoke/*` routes exist only under `alchemy dev` (see apps/api/src/smoke-routes.ts).
    const dev = yield* Alchemy.ALCHEMY_DEV;

    const db = yield* Database;
    const queue = yield* EnrichmentQueue;

    const api = yield* Cloudflare.Worker("Api", {
      main: "./apps/api/src/worker.ts",
      env: { DB: db, ENRICHMENT_QUEUE: queue, SMOKE_ROUTES: dev ? "on" : "off" },
      dev: { host, port, strictPort: true },
    });

    yield* Cloudflare.Queues.Consumer("EnrichmentConsumer", {
      queueId: queue.queueId,
      scriptName: api.workerName,
      settings: { batchSize: 10, maxWaitTimeMs: 1000 },
    });

    return { url: api.url };
  }),
);
