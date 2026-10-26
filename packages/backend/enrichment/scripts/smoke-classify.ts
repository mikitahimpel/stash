// Opt-in smoke test: runs `classifyLink` against the real Anthropic API over synthetic inputs and
// prints a Markdown table. It is not part of `test` and never runs in CI. Run it only through
// Proton Pass, so the key never touches a file:
//
//   PROTON_PASS_AGENT_REASON="stash classifier smoke test" \
//     pp run --env-file .env -- pnpm --filter @stash/backend-enrichment smoke:classify
//
// The key is read once into a `Redacted` and is never printed. Failures print only the error's
// reason tag, never the request or the response.
import * as AnthropicConfig from "@stash/backend-platform/anthropic-config";
import * as HttpClientLive from "@stash/backend-platform/http-client";
import type * as Link from "@stash/contracts-domain/link";
import * as LanguageModel from "effect/ai/LanguageModel";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as ClassifyLink from "../src/classify-link.ts";
import type * as ContentText from "../src/content-text.ts";

interface Case {
  readonly name: string;
  readonly expectedType: Link.LinkType;
  readonly expectedLanguage: string;
  readonly input: ClassifyLink.ClassifyInput;
}

const content = (
  fields: Partial<ContentText.ContentText> & Pick<ContentText.ContentText, "text">,
): Option.Option<ContentText.ContentText> =>
  Option.some({
    title: Option.none(),
    description: Option.none(),
    language: Option.none(),
    source: "page",
    ...fields,
  });

// Synthetic snippets written for this script: invented URLs, titles and text, no personal data.
const cases: ReadonlyArray<Case> = [
  {
    name: "en-article",
    expectedType: "article",
    expectedLanguage: "en",
    input: {
      url: "https://example.com/blog/effect-schema-migrations",
      title: Option.some("Versioning JSON payloads with Effect Schema"),
      content: content({
        language: Option.some("en"),
        text:
          "When an API evolves, old clients keep sending old payloads. In this post we walk " +
          "through a pattern for versioned schemas in TypeScript: each version is a Schema, " +
          "and decoding upgrades older shapes step by step. We compare it with hand-written " +
          "migrations, show how to test every upgrade path, and discuss when a breaking change " +
          "is cheaper than another compatibility layer.",
      }),
    },
  },
  {
    name: "ru-article",
    expectedType: "article",
    expectedLanguage: "ru",
    input: {
      url: "https://example.com/ru/posts/central-bank-rates",
      title: Option.some("Почему центробанки поднимают ставку"),
      content: content({
        language: Option.some("ru"),
        text:
          "Ключевая ставка — главный инструмент денежно-кредитной политики. Когда инфляция " +
          "растёт, центральный банк повышает ставку, кредиты дорожают, спрос замедляется, и " +
          "цены растут медленнее. В статье разбираем, почему эффект проявляется с задержкой в " +
          "полгода-год, как ставка влияет на курс рубля и депозиты и почему рынок реагирует " +
          "на ожидания раньше самого решения.",
      }),
    },
  },
  {
    name: "en-video",
    expectedType: "video",
    expectedLanguage: "en",
    input: {
      url: "https://www.youtube.com/watch?v=exampleVid01",
      title: Option.some("Designing local-first apps with CRDTs — conference talk"),
      content: content({
        source: "transcript",
        text:
          "hi everyone thanks for coming so today I want to talk about local-first software " +
          "and why I think CRDTs finally make it practical we'll start with the problem of " +
          "offline edits then I'll show a live demo of two devices merging a document without " +
          "a server and at the end we'll look at the trade-offs around storage growth and " +
          "garbage collection of tombstones",
      }),
    },
  },
  {
    name: "ru-video",
    expectedType: "video",
    expectedLanguage: "ru",
    input: {
      url: "https://www.youtube.com/watch?v=exampleVid02",
      title: Option.some("Как устроен PostgreSQL изнутри: MVCC и вакуум"),
      content: content({
        source: "transcript",
        text:
          "всем привет сегодня разберём как постгрес хранит версии строк каждая транзакция " +
          "видит свой снимок данных старые версии остаются в таблице пока их не уберёт вакуум " +
          "покажу на примере почему таблица раздувается если долго держать открытую транзакцию " +
          "и как настроить автовакуум под нагрузку",
      }),
    },
  },
  {
    name: "en-repo",
    expectedType: "repo",
    expectedLanguage: "en",
    input: {
      url: "https://github.com/example-org/tiny-queue",
      title: Option.some("example-org/tiny-queue: a durable job queue on SQLite"),
      content: content({
        language: Option.some("en"),
        description: Option.some("A durable job queue for Node.js backed by SQLite"),
        text:
          "tiny-queue is a durable background job queue for Node.js that stores jobs in a " +
          "single SQLite file. Features: at-least-once delivery, retries with exponential " +
          "backoff, scheduled jobs, and a tiny web dashboard. Installation: npm install " +
          "tiny-queue. Usage: create a queue, register a handler, enqueue jobs. License: MIT.",
      }),
    },
  },
  {
    name: "ru-repo",
    expectedType: "repo",
    expectedLanguage: "ru",
    input: {
      url: "https://github.com/example-org/ru-stemmer",
      title: Option.some("example-org/ru-stemmer"),
      content: content({
        language: Option.some("ru"),
        text:
          "ru-stemmer — библиотека на Rust для стемминга русских слов. Поддерживает алгоритм " +
          "Портера и словарные исключения, работает без аллокаций на горячем пути. Установка: " +
          "cargo add ru-stemmer. Пример использования и бенчмарки — ниже. Лицензия MIT.",
      }),
    },
  },
  {
    name: "en-tool",
    expectedType: "tool",
    expectedLanguage: "en",
    input: {
      url: "https://example.com/products/diagramly",
      title: Option.some("Diagramly — turn text into diagrams"),
      content: content({
        language: Option.some("en"),
        text:
          "Diagramly turns plain text into sequence diagrams, flowcharts and ER diagrams right " +
          "in your browser. Share a link, embed diagrams in your docs, or export to SVG. Free " +
          "for personal use; the team plan adds shared workspaces. Start drawing — no sign-up " +
          "needed.",
      }),
    },
  },
  {
    name: "ru-tool-banner",
    expectedType: "tool",
    expectedLanguage: "ru",
    input: {
      url: "https://example.com/ru/app/perevodchik-subtitrov",
      title: Option.some("Переводчик субтитров онлайн — бесплатный сервис"),
      // Only a cookie banner came back, so the classifier has to go by the URL and the title.
      content: content({
        language: Option.some("ru"),
        text: "Мы используем файлы cookie. Продолжая пользоваться сайтом, вы соглашаетесь. Принять",
      }),
    },
  },
];

interface Usage {
  inputTokens: number;
  outputTokens: number;
}

/** Wraps the model so each `generateObject` call records its token usage into `usage`. */
const recordUsage = (usage: Usage) =>
  Layer.effect(LanguageModel.LanguageModel)(
    Effect.gen(function* () {
      const model = yield* LanguageModel.LanguageModel;
      const generateObject = ((options: Parameters<typeof model.generateObject>[0]) =>
        model.generateObject(options).pipe(
          Effect.tap((response) =>
            Effect.sync(() => {
              usage.inputTokens += response.usage.inputTokens.total ?? 0;
              usage.outputTokens += response.usage.outputTokens.total ?? 0;
            }),
          ),
        )) as typeof model.generateObject;
      return { ...model, generateObject };
    }),
  );

const cell = (text: string): string => text.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();

const run = Effect.gen(function* () {
  const config = yield* AnthropicConfig.fromEnv(process.env);
  const base = ClassifyLink.layerAnthropic.pipe(
    Layer.provide(Layer.succeed(AnthropicConfig.AnthropicConfig)(config)),
    Layer.provide(HttpClientLive.layer),
  );

  const rows = [
    `Model: \`${ClassifyLink.model}\``,
    "",
    "| case | type (expected) | lang (expected) | tags | summary | in / out tokens | latency |",
    "|---|---|---|---|---|---|---|",
  ];
  let failures = 0;
  let mismatches = 0;
  const total: Usage = { inputTokens: 0, outputTokens: 0 };

  for (const smoke of cases) {
    const usage: Usage = { inputTokens: 0, outputTokens: 0 };
    const started = performance.now();
    const result = yield* ClassifyLink.classifyLink(smoke.input).pipe(
      Effect.provide(recordUsage(usage).pipe(Layer.provide(base))),
      Effect.result,
    );
    const latency = `${Math.round(performance.now() - started)} ms`;
    total.inputTokens += usage.inputTokens;
    total.outputTokens += usage.outputTokens;
    const tokens = `${usage.inputTokens} / ${usage.outputTokens}`;

    if (result._tag === "Failure") {
      failures += 1;
      const reason = result.failure.cause.reason._tag;
      rows.push(`| ${smoke.name} | FAILED: ${reason} | | | | ${tokens} | ${latency} |`);
      continue;
    }
    const c = result.success;
    const language = Option.getOrElse(c.language, () => "none");
    const typeOk = c.type === smoke.expectedType;
    const languageOk = language === smoke.expectedLanguage;
    if (!typeOk || !languageOk) mismatches += 1;
    rows.push(
      `| ${smoke.name} | ${c.type}${typeOk ? "" : ` (≠ ${smoke.expectedType})`} | ` +
        `${language}${languageOk ? "" : ` (≠ ${smoke.expectedLanguage})`} | ` +
        `${cell(c.tags.join(", "))} | ${cell(c.summary)} | ${tokens} | ${latency} |`,
    );
  }

  rows.push(
    "",
    `Total tokens: ${total.inputTokens} in / ${total.outputTokens} out. ` +
      `Failures: ${failures}. Type or language mismatches: ${mismatches}.`,
  );
  yield* Effect.sync(() => console.log(rows.join("\n")));
  return failures;
});

Effect.runPromise(run).then(
  (failures) => {
    process.exitCode = failures === 0 ? 0 : 1;
  },
  (error: unknown) => {
    // Only the error's tag: a config error never holds the key, but nothing else is trusted.
    const tag =
      typeof error === "object" && error !== null && "_tag" in error ? error._tag : "UnknownError";
    console.error(`smoke:classify failed: ${String(tag)}`);
    process.exitCode = 1;
  },
);
