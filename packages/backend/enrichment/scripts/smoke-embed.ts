// Opt-in smoke test: embeds texts with the real Workers AI model (`@cf/baai/bge-m3`, through the
// Cloudflare REST API) and runs the full real pipeline (fetch → Anthropic classifier → embedding)
// on a few public RU + EN pages. It prints Markdown and exits 1 if a check fails. It is not part of
// `test` and never runs in CI. Run it only through Proton Pass, so no credential touches a file:
//
//   PROTON_PASS_AGENT_REASON="stash embeddings smoke test" \
//     pp run --env-file .env -- pnpm --filter @stash/backend-enrichment smoke:embed
//
// Credentials are read once into `Redacted` values and are never printed. The account id is part
// of the API URL, so errors print only their tag and an HTTP status, never a request or a cause.
import * as Ai from "@stash/backend-platform/ai";
import * as AnthropicConfig from "@stash/backend-platform/anthropic-config";
import * as HttpClientLive from "@stash/backend-platform/http-client";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as ClassifyLink from "../src/classify-link.ts";
import * as EmbedLink from "../src/embed-link.ts";
import * as FetchContent from "../src/fetch-content.ts";

/** A failed step, with only what is safe to print. */
class SmokeError extends Data.TaggedError("SmokeError")<{ readonly reason: string }> {}

const CloudflareEnv = Schema.Struct({
  CLOUDFLARE_API_TOKEN: Schema.String.pipe(Schema.check(Schema.isNonEmpty())),
  CLOUDFLARE_ACCOUNT_ID: Schema.String.pipe(Schema.check(Schema.isNonEmpty())),
});

const cloudflareFromEnv = Schema.decodeUnknownEffect(CloudflareEnv)(process.env).pipe(
  Effect.map((vars) => ({
    apiToken: Redacted.make(vars.CLOUDFLARE_API_TOKEN),
    accountId: Redacted.make(vars.CLOUDFLARE_ACCOUNT_ID),
  })),
  // A schema issue may quote the value, so only the shape of the problem is kept.
  Effect.mapError(
    () =>
      new SmokeError({
        reason: "CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID must be non-empty strings",
      }),
  ),
);

// https://developers.cloudflare.com/api/resources/ai/methods/run/
const RunResponse = Schema.Struct({ success: Schema.Boolean, result: Schema.Unknown });

/**
 * `Ai.embed` over the Workers AI REST API instead of the Worker binding, so the platform's
 * response decoding and count check run unchanged.
 */
const restAi = (credentials: Effect.Success<typeof cloudflareFromEnv>) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const url =
      `https://api.cloudflare.com/client/v4/accounts/` +
      `${Redacted.value(credentials.accountId)}/ai/run/${Ai.embeddingModel}`;
    const run = (inputs: { text: Array<string> }) =>
      Effect.gen(function* () {
        const response = yield* client.execute(
          HttpClientRequest.post(url).pipe(
            HttpClientRequest.bearerToken(Redacted.value(credentials.apiToken)),
            HttpClientRequest.acceptJson,
            HttpClientRequest.bodyJsonUnsafe(inputs),
          ),
        );
        if (response.status !== 200) {
          return yield* new SmokeError({ reason: `Workers AI answered ${response.status}` });
        }
        const body = yield* Schema.decodeUnknownEffect(RunResponse)(yield* response.json);
        if (!body.success) return yield* new SmokeError({ reason: "Workers AI success: false" });
        return body.result;
      }).pipe(
        Effect.timeout("30 seconds"),
        Effect.mapError((error) =>
          error instanceof SmokeError ? error : new SmokeError({ reason: error._tag }),
        ),
      );
    return Ai.make({
      run: (_model, inputs) =>
        Effect.runPromise(run(inputs).pipe(Effect.provideService(HttpClient.HttpClient, client))),
    });
  });

/** The reason of an `AiError` from `restAi`: a `SmokeError` reason or a decoding problem. */
const aiReason = (error: Ai.AiError): string =>
  error.cause instanceof SmokeError
    ? error.cause.reason
    : typeof error.cause === "string"
      ? error.cause
      : "unexpected Workers AI response";

const cosine = (a: ReadonlyArray<number>, b: ReadonlyArray<number>): number => {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return dot / Math.sqrt(na * nb);
};

const fixed = (n: number): string => n.toFixed(3);
const cell = (text: string): string => text.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();

// Synthetic snippets written for this script, one RU and one EN text per topic. No personal data.
const topics: ReadonlyArray<{ readonly topic: string; readonly en: string; readonly ru: string }> =
  [
    {
      topic: "crdt",
      en:
        "Local-first apps keep data on the device and sync it later. CRDTs let two devices " +
        "edit the same document offline and merge the changes without a central server.",
      ru:
        "Local-first приложения хранят данные на устройстве и синхронизируют их позже. CRDT " +
        "позволяют двум устройствам править один документ офлайн и сливать изменения без сервера.",
    },
    {
      topic: "rates",
      en:
        "When inflation rises, the central bank raises its key interest rate. Loans get more " +
        "expensive, demand slows down, and prices grow more slowly after a delay of months.",
      ru:
        "Когда инфляция растёт, центральный банк повышает ключевую ставку. Кредиты дорожают, " +
        "спрос замедляется, и цены через несколько месяцев растут медленнее.",
    },
    {
      topic: "postgres",
      en:
        "PostgreSQL keeps several versions of each row so every transaction sees its own " +
        "snapshot. Vacuum removes old versions; a long open transaction makes tables bloat.",
      ru:
        "PostgreSQL хранит несколько версий каждой строки, чтобы каждая транзакция видела свой " +
        "снимок. Вакуум удаляет старые версии, а долгая открытая транзакция раздувает таблицы.",
    },
    {
      topic: "sourdough",
      en:
        "Feed the sourdough starter the night before, mix flour, water and salt, let the " +
        "dough rise for several hours, then bake the loaf in a hot covered pot.",
      ru:
        "Накануне вечером подкормите закваску, смешайте муку, воду и соль, дайте тесту " +
        "подняться несколько часов и испеките хлеб в горячей закрытой кастрюле.",
    },
  ];

// Public pages fetched at run time: two RU/EN pairs on the same topic plus a repo.
const pages: ReadonlyArray<{
  readonly name: string;
  readonly topic: string;
  readonly url: string;
}> = [
  { name: "en-wiki-postgres", topic: "postgres", url: "https://en.wikipedia.org/wiki/PostgreSQL" },
  { name: "ru-wiki-postgres", topic: "postgres", url: "https://ru.wikipedia.org/wiki/PostgreSQL" },
  { name: "en-wiki-inflation", topic: "inflation", url: "https://en.wikipedia.org/wiki/Inflation" },
  {
    name: "ru-wiki-inflation",
    topic: "inflation",
    url: "https://ru.wikipedia.org/wiki/%D0%98%D0%BD%D1%84%D0%BB%D1%8F%D1%86%D0%B8%D1%8F",
  },
  { name: "en-repo-effect", topic: "effect", url: "https://github.com/Effect-TS/effect" },
];

interface Embedded {
  readonly name: string;
  readonly topic: string;
  readonly language: string;
  readonly vector: ReadonlyArray<number>;
}

/**
 * Cross-language sanity: every same-topic RU/EN pair must score higher than every pair of
 * different topics (in any language). Prints the same-topic scores and the margin.
 */
const crossLanguage = (title: string, items: ReadonlyArray<Embedded>, out: Array<string>) => {
  const same: Array<{ pair: string; score: number }> = [];
  let worst = { pair: "none", score: -1 };
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i]!;
      const b = items[j]!;
      const score = cosine(a.vector, b.vector);
      const pair = `${a.name} ↔ ${b.name}`;
      if (a.topic === b.topic && a.language !== b.language) same.push({ pair, score });
      else if (a.topic !== b.topic && score > worst.score) worst = { pair, score };
    }
  }
  const lowest = Math.min(...same.map((s) => s.score));
  const ok = same.length > 0 && lowest > worst.score;
  out.push(
    "",
    `### ${title}`,
    "",
    "| same-topic RU ↔ EN pair | cosine |",
    "|---|---|",
    ...same.map((s) => `| ${s.pair} | ${fixed(s.score)} |`),
    "",
    `Highest unrelated pair: ${worst.pair} (${fixed(worst.score)}). ` +
      `Lowest same-topic pair: ${fixed(lowest)}. Margin: ${fixed(lowest - worst.score)}. ` +
      `Cross-language check: ${ok ? "PASS" : "FAIL"}.`,
  );
  return ok;
};

const run = Effect.gen(function* () {
  const cloudflare = yield* cloudflareFromEnv;
  const anthropic = yield* AnthropicConfig.fromEnv(process.env);
  const ai = yield* restAi(cloudflare);
  const model = ClassifyLink.layerAnthropic.pipe(
    Layer.provide(Layer.succeed(AnthropicConfig.AnthropicConfig)(anthropic)),
    Layer.provide(HttpClientLive.layer),
  );

  const out = [`Embedding model: \`${Ai.embeddingModel}\`. Classifier: \`${ClassifyLink.model}\`.`];
  let failures = 0;

  /** One embedding call, timed. */
  const embed = (text: string) =>
    Effect.gen(function* () {
      const started = performance.now();
      const result = yield* ai.embed([text]).pipe(Effect.result);
      const latency = Math.round(performance.now() - started);
      if (result._tag === "Failure") return { latency, error: aiReason(result.failure) };
      const vector = result.success[0] ?? [];
      return { latency, vector };
    });

  // 1. Synthetic texts: dimension, latency and cross-language similarity.
  out.push("", "### Synthetic texts", "", "| text | dimension | latency |", "|---|---|---|");
  const synthetic: Array<Embedded> = [];
  const latencies: Array<number> = [];
  for (const t of topics) {
    for (const language of ["en", "ru"] as const) {
      const name = `${language}-${t.topic}`;
      const e = yield* embed(t[language]);
      latencies.push(e.latency);
      if ("error" in e) {
        failures += 1;
        out.push(`| ${name} | FAILED: ${cell(e.error)} | ${e.latency} ms |`);
        continue;
      }
      const dimensionOk = e.vector.length === Ai.embeddingDimensions;
      if (!dimensionOk) failures += 1;
      out.push(
        `| ${name} | ${e.vector.length}${dimensionOk ? "" : ` (≠ ${Ai.embeddingDimensions})`} | ` +
          `${e.latency} ms |`,
      );
      synthetic.push({ name, topic: t.topic, language, vector: e.vector });
    }
  }
  const sorted = [...latencies].sort((a, b) => a - b);
  out.push(
    "",
    `Expected dimension (Vectorize index, \`Ai.embeddingDimensions\`): ${Ai.embeddingDimensions}. ` +
      `Latency per call: min ${sorted[0]} ms, median ${sorted[Math.floor(sorted.length / 2)]} ms, ` +
      `max ${sorted[sorted.length - 1]} ms.`,
  );
  if (!crossLanguage("Cross-language similarity (synthetic)", synthetic, out)) failures += 1;

  // 2. The full real pipeline on public pages.
  out.push(
    "",
    "### Full pipeline (fetch → classify → embed)",
    "",
    "| page | fetched chars | type | lang | tags | dimension | fetch / classify / embed |",
    "|---|---|---|---|---|---|---|",
  );
  const pipeline: Array<Embedded> = [];
  for (const page of pages) {
    let started = performance.now();
    const fetched = yield* FetchContent.fetchContent(page.url).pipe(
      Effect.provide(HttpClientLive.layer),
      Effect.result,
    );
    const fetchMs = Math.round(performance.now() - started);
    if (fetched._tag === "Failure") {
      failures += 1;
      const { reason, status } = fetched.failure;
      out.push(
        `| ${page.name} | FAILED fetch: ${reason} ${status ?? ""} | | | | | ${fetchMs} ms |`,
      );
      continue;
    }
    const content = fetched.success;

    started = performance.now();
    const classified = yield* ClassifyLink.classifyLink({
      url: page.url,
      title: content.title,
      content: Option.some(content),
    }).pipe(Effect.provide(model), Effect.result);
    const classifyMs = Math.round(performance.now() - started);
    if (classified._tag === "Failure") {
      failures += 1;
      const reason = classified.failure.cause.reason._tag;
      out.push(
        `| ${page.name} | ${content.text.length} | FAILED classify: ${reason} | | | | ` +
          `${fetchMs} / ${classifyMs} ms |`,
      );
      continue;
    }
    const c = classified.success;

    const e = yield* embed(
      EmbedLink.embeddingText({
        title: content.title,
        summary: c.summary,
        tags: c.tags,
        text: content.text,
      }),
    );
    const timings = `${fetchMs} / ${classifyMs} / ${e.latency} ms`;
    const language = Option.getOrElse(c.language, () => "none");
    const head = `| ${page.name} | ${content.text.length} | ${c.type} | ${language} | ${cell(c.tags.join(", "))}`;
    if ("error" in e) {
      failures += 1;
      out.push(`${head} | FAILED embed: ${cell(e.error)} | ${timings} |`);
      continue;
    }
    const dimensionOk = e.vector.length === Ai.embeddingDimensions;
    if (!dimensionOk) failures += 1;
    out.push(`${head} | ${e.vector.length} | ${timings} |`);
    pipeline.push({ name: page.name, topic: page.topic, language, vector: e.vector });
  }
  if (!crossLanguage("Cross-language similarity (pipeline)", pipeline, out)) failures += 1;

  out.push("", `Failed checks: ${failures}.`);
  yield* Effect.sync(() => console.log(out.join("\n")));
  return failures;
});

Effect.runPromise(run.pipe(Effect.provide(HttpClientLive.layer))).then(
  (failures) => {
    process.exitCode = failures === 0 ? 0 : 1;
  },
  (error: unknown) => {
    // Only the error's tag and, for our own errors, its safe reason.
    const tag =
      typeof error === "object" && error !== null && "_tag" in error ? error._tag : "UnknownError";
    const reason = error instanceof SmokeError ? `: ${error.reason}` : "";
    console.error(`smoke:embed failed: ${String(tag)}${reason}`);
    process.exitCode = 1;
  },
);
