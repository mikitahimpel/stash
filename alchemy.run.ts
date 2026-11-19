// Infrastructure for Stash, declared with Alchemy v2 (beta). See docs/alchemy.md.
//
// Physical names are derived from the stack, the stage (`--stage` or ALCHEMY_STAGE) and the logical
// ids below, except on stage `prod`, which pins them (`PROD_NAMES`). The only personal values are
// the owner's public GitHub login and the hostname of `prod`, committed at the owner's request. The
// Cloudflare account comes from CLOUDFLARE_ACCOUNT_ID or the Alchemy profile, used only by
// `alchemy deploy`.
// `alchemy dev` emulates every resource here locally and needs no credentials.
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as BuildMemo from "@stash/web/build-memo";
import * as Alchemy from "alchemy";
import * as D1State from "./alchemy-d1-state.ts";
import * as State from "alchemy/State";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpIncomingMessage from "effect/http/HttpIncomingMessage";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

// Public client id of the project's GitHub OAuth App (Device Flow enabled, no client secret), the
// default for stage `prod`. See docs/deploy.md#github-oauth-app.
const PROD_GITHUB_CLIENT_ID = "Ov23liVGZpbhL9oxUor1";

// The GitHub login allowed to sign in on stage `prod`, given by the owner. Env overrides it, and any
// other deployed stage requires it in env.
const PROD_ALLOWED_GITHUB_LOGIN = "mikitahimpel";

// The hostname stage `prod` is served on, given by the owner (#179): the web app, the api under
// `/api` and the MCP server under `/mcp`. Its zone is in the deploy's Cloudflare account. Env
// (`STASH_DOMAIN`) overrides it. Any other deployed stage has no domain unless env sets one, and
// stays on `workers.dev`.
const PROD_DOMAIN = "stash.mikitahimpel.com";

// Physical names of the prod storage, fixed to the resources the first deploys created (#46), so a
// deploy adopts them by name even without state and never creates a second set. Other stages keep
// Alchemy's derived names (`stash-<LogicalId>-<stage>-<hash>`).
const PROD_NAMES = {
  Database: "stash-Database-prod-mf7bdmx2cin6nqko",
  EnrichmentQueue: "stash-enrichmentqueue-prod-xr6su4vb2weizt5f",
  OAuthState: "stash-OAuthState-prod-wtlexz4tokrclmex",
  Kv: "stash-Kv-prod-ddgdjqdf2o62pk44",
  Blobs: "stash-blobs-prod-c44vgsaqvuv5q444",
  Vectors: "stash-vectors-prod-7xiz3wsxkfqiiid4",
} as const;

// Deployed stage `prod` keeps its state in D1 (see alchemy-d1-state.ts), so it no longer lives in
// the checkout that deployed. `alchemy dev` and other stages keep it in the gitignored `.alchemy/`.
const state = Layer.unwrap(
  Effect.gen(function* () {
    const stage = yield* Alchemy.Stage;
    const dev = yield* Alchemy.ALCHEMY_DEV;
    return stage === "prod" && !dev
      ? (D1State.d1State({ databaseName: "stash-alchemy-state" }) as Layer.Layer<
          State.State,
          never,
          HttpClient.HttpClient | FileSystem.FileSystem | Path.Path
        >)
      : State.localState();
  }).pipe(Effect.orDie),
);

export default Alchemy.Stack(
  "stash",
  {
    providers: Cloudflare.providers(),
    state,
  },
  Effect.gen(function* () {
    const port = yield* Config.Port("STASH_API_PORT").pipe(Config.withDefault(8787));
    const host = yield* Config.String("STASH_API_HOST").pipe(Config.withDefault("0.0.0.0"));
    const webPort = yield* Config.Port("STASH_WEB_PORT").pipe(Config.withDefault(8791));
    const webHost = yield* Config.String("STASH_WEB_HOST").pipe(Config.withDefault("0.0.0.0"));
    // The `/_smoke/*` routes exist only under `alchemy dev` (see apps/api/src/smoke-routes.ts).
    const dev = yield* Alchemy.ALCHEMY_DEV;
    const stage = yield* Alchemy.Stage;
    // Personal values come from env. Local dev gets placeholders; a deploy requires real ones.
    // `dev_only` can never be a GitHub login (GitHub allows no underscores).
    const devDefault = <A>(config: Config.Config<A>, value: A) =>
      dev ? config.pipe(Config.withDefault(value)) : config;
    // Optional on deploy: `None` leaves the binding out or falls back to a derived value.
    const devDefaultOption = <A>(config: Config.Config<A>, value: A) =>
      dev ? config.pipe(Config.withDefault(value), Config.map(Option.some)) : Config.option(config);
    const allowedGithubLogin = yield* devDefault(
      stage === "prod"
        ? Config.String("STASH_ALLOWED_GITHUB_LOGIN").pipe(
            Config.withDefault(PROD_ALLOWED_GITHUB_LOGIN),
          )
        : Config.String("STASH_ALLOWED_GITHUB_LOGIN"),
      "dev_only",
    );
    // The GitHub OAuth app's client id. The Device Flow login needs no client secret, and the id
    // is public, so it is bound as a plain var. Local dev gets a placeholder that GitHub rejects.
    // Stage `prod` defaults to the committed id of the project's OAuth app. Any other stage without
    // it still deploys, and the login routes answer 503 (see docs/deploy.md). Env always wins.
    const githubClientId = yield* devDefaultOption(
      stage === "prod"
        ? Config.String("GITHUB_CLIENT_ID").pipe(Config.withDefault(PROD_GITHUB_CLIENT_ID))
        : Config.String("GITHUB_CLIENT_ID"),
      "dev_only",
    );
    const mcpPort = yield* Config.Port("STASH_MCP_PORT").pipe(Config.withDefault(8790));
    // The classifier's key, bound as `secret_text`. `alchemy dev` never reads it, so local dev stays
    // credential-free (the enrichment consumer then retries each message, see apps/api/src/worker.ts).
    const anthropicApiKey = dev
      ? Option.none<Redacted.Redacted<string>>()
      : yield* Config.option(Config.Redacted("ANTHROPIC_API_KEY"));

    // Deployed Workers get fixed names: `stash-<role>` on stage `prod`, `stash-<role>-<stage>`
    // otherwise. `alchemy dev` keeps the derived names.
    const workerName = (role: string) =>
      stage === "prod"
        ? `stash-${role}`
        : `stash-${role}-${stage.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`;
    const named = (role: string) => (dev ? {} : { name: workerName(role) });
    // The custom domain of a deployed stage: a bare hostname whose zone is in the Cloudflare
    // account. `alchemy dev` has none. An empty `STASH_DOMAIN` keeps a stage on `workers.dev`.
    const domain = dev
      ? Option.none<string>()
      : Option.filter(
          yield* Config.option(
            stage === "prod"
              ? Config.String("STASH_DOMAIN").pipe(Config.withDefault(PROD_DOMAIN))
              : Config.String("STASH_DOMAIN"),
          ),
          (name) => name !== "",
        );
    // The public origins. Everything that names the site derives from them: the api's CORS and
    // the origin its live stream accepts (`WEB_ORIGIN`), the Connect page's MCP URL, the OAuth
    // issuer and MCP resource (`MCP_ORIGIN`), and the origin baked into the extension the site
    // serves (`STASH_WEB_ORIGIN` of the build). Session cookies are host-only, so they follow.
    //
    // With a domain, the site and the MCP server share it (`https://<domain>` and
    // `https://<domain>/mcp`): the `Web` Worker owns the hostname and hands the MCP paths to `Mcp`
    // through a Service Binding (see `Web` below), and `STASH_WEB_ORIGIN` / `STASH_MCP_ORIGIN` are
    // not read. `mcpLegacy` is then the `workers.dev` address `Mcp` had before, where it keeps
    // answering for connectors added with the old URL. Without a domain the origins are derived
    // from the fixed names and the account's workers.dev subdomain, unless set.
    const origins: {
      readonly web: string;
      readonly mcp: string;
      readonly mcpLegacy?: string;
    } = dev
      ? {
          web: yield* Config.String("STASH_WEB_ORIGIN").pipe(
            Config.withDefault("http://localhost:5173"),
          ),
          mcp: yield* Config.String("STASH_MCP_ORIGIN").pipe(
            Config.withDefault(`http://localhost:${mcpPort}`),
          ),
        }
      : yield* Effect.gen(function* () {
          const subdomain = yield* workersSubdomain;
          const workersDev = (role: string) =>
            `https://${workerName(role)}.${subdomain}.workers.dev`;
          if (Option.isSome(domain)) {
            const origin = `https://${domain.value}`;
            return { web: origin, mcp: origin, mcpLegacy: workersDev("mcp") };
          }
          return {
            web: yield* Config.String("STASH_WEB_ORIGIN").pipe(
              Config.withDefault(workersDev("web")),
            ),
            mcp: yield* Config.String("STASH_MCP_ORIGIN").pipe(
              Config.withDefault(workersDev("mcp")),
            ),
          };
        });
    const optional = <K extends string, A>(key: K, value: Option.Option<A>) =>
      Option.match(value, {
        onNone: () => ({}),
        onSome: (a) => ({ [key]: a }),
      }) as { readonly [P in K]?: A };

    const prodName = <K extends keyof typeof PROD_NAMES>(id: K, key: "name" | "title" = "name") =>
      stage === "prod" && !dev ? { [key]: PROD_NAMES[id] } : {};

    // Migrations are applied in order on every reconcile (`alchemy dev` and deploy). Bookkeeping
    // lives in Alchemy's `__alchemy_migrations` table. Paths resolve from the repo root.
    const db = yield* Cloudflare.D1.Database("Database", {
      migrations: "./apps/api/migrations",
      ...prodName("Database"),
    });
    const queue = yield* Cloudflare.Queues.Queue("EnrichmentQueue", prodName("EnrichmentQueue"));
    // OAuth clients, grants and tokens of the MCP server (`@cloudflare/workers-oauth-provider`).
    const oauthState = yield* Cloudflare.KV.Namespace(
      "OAuthState",
      prodName("OAuthState", "title"),
    );
    // Save rate limits of the `Api` Worker.
    const kv = yield* Cloudflare.KV.Namespace("Kv", prodName("Kv", "title"));
    // Extracted page text and transcripts, written by the enrichment consumer.
    const blobs = yield* Cloudflare.R2.Bucket("Blobs", prodName("Blobs"));
    // Link embeddings: `@cf/baai/bge-m3` vectors (1024-d), compared by cosine similarity. Vectorize
    // and Workers AI have no local provider, so only a deploy creates and binds them.
    const vectors = dev
      ? undefined
      : yield* Cloudflare.Vectorize.Index("Vectors", {
          dimensions: 1024,
          metric: "cosine",
          ...prodName("Vectors"),
        });

    const api = yield* Cloudflare.Worker("Api", {
      main: "./apps/api/src/worker.ts",
      ...named("api"),
      env: {
        DB: db,
        ENRICHMENT_QUEUE: queue,
        KV: kv,
        BLOBS: blobs,
        // The Worker's own Durable Object class `LinkEvents` (apps/api/src/worker.ts): one object
        // per user holds the open WebSockets of `GET /events` (the live link updates). Alchemy
        // creates the class with SQLite storage, the only kind a new namespace can have, and
        // drives its class migration. A namespace has no name of its own: it belongs to the
        // Worker script, which `named("api")` fixes, so `PROD_NAMES` has nothing to pin here.
        LINK_EVENTS: Cloudflare.DurableObject("LinkEvents"),
        ...(vectors === undefined ? {} : { VECTORS: vectors, AI: Cloudflare.Workers.AI() }),
        ALLOWED_GITHUB_LOGIN: allowedGithubLogin,
        WEB_ORIGIN: origins.web,
        // For the Connect page's Claude guide (`GET /connect/info` answers `<MCP_ORIGIN>/mcp`).
        MCP_ORIGIN: origins.mcp,
        ...optional("GITHUB_CLIENT_ID", githubClientId),
        ...optional("ANTHROPIC_API_KEY", anthropicApiKey),
        SMOKE_ROUTES: dev ? "on" : "off",
      },
      // Auto-archive of stale Zen tabs (daily), the weekly digest (Mondays) and the requeue of links
      // still waiting for enrichment (hourly), in UTC. Must match the expressions in
      // apps/api/src/scheduled-handler.ts, which dispatches on them.
      crons: ["0 3 * * *", "0 6 * * 1", "0 * * * *"],
      dev: { host, port, strictPort: true },
    });

    yield* Cloudflare.Queues.Consumer("EnrichmentConsumer", {
      queueId: queue.queueId,
      scriptName: api.workerName,
      settings: { batchSize: 10, maxWaitTimeMs: 1000 },
    });

    // Bindings must match apps/mcp/src/worker-env.ts.
    const mcp = yield* Cloudflare.Worker("Mcp", {
      main: "./apps/mcp/src/worker.ts",
      ...named("mcp"),
      env: {
        // The api's `InternalApi` entrypoint: the public `StashApi` plus `POST /internal/mcp-tokens`,
        // which mints the api token for each grant when the owner authorizes Claude. A named
        // entrypoint is reachable only through this binding, never from the internet.
        API: Cloudflare.WorkerEntrypoint(api, "InternalApi"),
        OAUTH_KV: oauthState,
        MCP_ORIGIN: origins.mcp,
        ...optional("MCP_LEGACY_ORIGIN", Option.fromNullishOr(origins.mcpLegacy)),
        ...optional("GITHUB_CLIENT_ID", githubClientId),
        ALLOWED_GITHUB_LOGIN: allowedGithubLogin,
      },
      dev: { host, port: mcpPort, strictPort: true },
    });

    // The SPA, served as Workers Static Assets, with the api same-origin under `/api`: the `Web`
    // Worker (`apps/web/src/web-worker.ts`) forwards `/api/*` to `Api` through the `API` Service
    // Binding with the prefix stripped, so the session cookie is first-party (`*.workers.dev` is
    // on the Public Suffix List, so `stash-web` and `stash-api` are different sites). The Worker
    // runs first for every path but the static files under `/assets/` and `/downloads/`, and
    // hands what is not its own to the assets, where unknown paths fall back to `index.html` so
    // the client router takes over. The build needs no api URL: the client calls
    // `/api` on its own origin. `alchemy dev` builds `apps/web` and serves `dist/` the same way,
    // against the local `Api`. For hot reload use `pnpm dev:web` (Vite, which proxies `/api`).
    // `build:deploy` also puts the installable clients under `/downloads/` (the Connect page links
    // them): the Zen / Firefox extension (`stash-extension.xpi`, signed when `WEB_EXT_API_KEY` and
    // `WEB_EXT_API_SECRET` are set, see apps/extension/README.md) and the Mac agent with its
    // installer (`stash-mac-agent.mjs`, `install-mac-agent.sh`). `alchemy dev` skips them and keeps
    // the plain build, which starts much faster. The build gets the site's own origin as
    // `STASH_WEB_ORIGIN` (`env` also reaches the build command), and the extension build bakes it
    // in (apps/extension/build-origin.ts), so the `.xpi` this site serves pairs with this site
    // without asking for an address.
    //
    // With a domain, Alchemy attaches the hostname to this Worker as a Cloudflare custom domain
    // (it creates the DNS record and the certificate; the zone is looked up by name), and the
    // Worker also serves the MCP server on it: `/mcp`, `/authorize*`, `/token`, `/register` and
    // `/.well-known/oauth-*` go to `Mcp` through the `MCP` binding with the URL unchanged, so the
    // OAuth discovery documents name this host. The SPA has no route under those paths
    // (apps/web/test/web-worker.test.ts). The Worker keeps its `workers.dev` address: there it
    // answers a GET of a page with a 301 to the domain, and still serves `/api` to old clients.
    const web = yield* Cloudflare.Website.StaticSite("Web", {
      cwd: "./apps/web",
      command: dev ? "pnpm run build" : "pnpm run build:deploy",
      outdir: "dist",
      main: "./apps/web/src/web-worker.ts",
      ...named("web"),
      // Bindings must match `WorkerEnv` in apps/web/src/web-worker.ts.
      env: {
        API: api,
        ...(Option.isSome(domain) ? { MCP: mcp } : {}),
        STASH_WEB_ORIGIN: origins.web,
      },
      ...(Option.isSome(domain) ? { domain: domain.value } : {}),
      assets: {
        notFoundHandling: "single-page-application",
        runWorkerFirst: ["/*", "!/assets/*", "!/downloads/*"],
      },
      // Rebuild when an input of the build changes. The globs, and why they must stay narrow, are
      // in apps/web/scripts/build-memo.ts.
      memo: { include: BuildMemo.include(dev), lockfile: true },
      dev: { host: webHost, port: webPort },
    });

    // With a domain, `webUrl` is `https://<domain>` and the MCP server is reached through it.
    return {
      url: api.url,
      mcpUrl: Option.isSome(domain) ? origins.mcp : mcp.url,
      webUrl: web.url,
    };
  }),
);

/**
 * The account's workers.dev subdomain (`<subdomain>` in `https://<name>.<subdomain>.workers.dev`),
 * read once from the Cloudflare API with the deploy's own credentials, or taken from
 * `CLOUDFLARE_WORKERS_SUBDOMAIN` (which Alchemy also honours). Neither value is ever logged.
 */
const workersSubdomain = Effect.gen(function* () {
  const configured = yield* Config.option(Config.String("CLOUDFLARE_WORKERS_SUBDOMAIN"));
  if (Option.isSome(configured) && configured.value !== "") return configured.value;
  const accountId = yield* Config.String("CLOUDFLARE_ACCOUNT_ID");
  const apiToken = yield* Config.Redacted("CLOUDFLARE_API_TOKEN");
  const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
  const response = yield* client.execute(
    HttpClientRequest.get(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`,
    ).pipe(HttpClientRequest.bearerToken(Redacted.value(apiToken))),
  );
  const body = yield* HttpIncomingMessage.schemaBodyJson(SubdomainResponse)(response);
  return body.result.subdomain;
}).pipe(
  Effect.provide(FetchHttpClient.layer),
  // The cause may quote the request URL, which holds the account id.
  Effect.mapError(
    () =>
      new Error(
        "Could not read the account's workers.dev subdomain. Set CLOUDFLARE_WORKERS_SUBDOMAIN, " +
          "or CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (see docs/deploy.md).",
      ),
  ),
  Effect.orDie,
);

const SubdomainResponse = Schema.Struct({
  result: Schema.Struct({ subdomain: Schema.String }),
});
