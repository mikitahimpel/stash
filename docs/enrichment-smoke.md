# Enrichment smoke tests

## Classifier (Anthropic)

An opt-in check of `classifyLink` (`packages/backend/enrichment/src/classify-link.ts`) against the
real Anthropic API (`claude-haiku-5-5`). It is not part of `test` and never runs in CI. Unit tests
keep using the fake `LanguageModel`.

### Running it

The key comes only from Proton Pass. Copy `.env.example` to `.env` (gitignored), which holds
`ANTHROPIC_API_KEY=pass://Stash/Anthropic/api_key`, then from the repo root:

```sh
PROTON_PASS_AGENT_REASON="stash classifier smoke test" \
  pp run --env-file .env -- pnpm --filter @stash/backend-enrichment smoke:classify
```

The script (`packages/backend/enrichment/scripts/smoke-classify.ts`, run with Node's built-in type
stripping) classifies 8 synthetic inputs (RU + EN, article, video, repo, tool, plus one page that
returned only a cookie banner). It prints a Markdown table with type, language, tags, summary,
token usage and latency per case. It exits 1 if any classification fails. Type or language
mismatches against the expected values are flagged in the table but do not fail the run. It never
prints the key. A failure prints only the error's reason tag.

### Results

Run on 2026-10-27 from the dev machine through `pp run` (exit 0). Latency is wall-clock per call
from the dev machine and includes network time.

Model: `claude-haiku-5-5`

| case | type (expected) | lang (expected) | tags | summary | in / out tokens | latency |
|---|---|---|---|---|---|---|
| en-article | article | en | effect schema, typescript, api versioning, json, schema migration | The post describes a pattern for versioning JSON payloads in TypeScript, where each schema version is a separate Effect Schema and decoding upgrades older shapes step by step. It compares this approach with hand-written migrations, shows how to test each upgrade path, and discusses when a breaking change is cheaper than maintaining a compatibility layer. | 927 / 158 | 3445 ms |
| ru-article | article | ru | monetary policy, interest rates, inflation, central banks, economics | Статья объясняет, как центральный банк использует ключевую ставку для борьбы с инфляцией и почему её эффект появляется с задержкой в полгода-год. Также рассматривается влияние ставки на курс рубля и депозиты и то, почему рынок реагирует на ожидания раньше самого решения. | 956 / 154 | 3171 ms |
| en-video | video | en | local-first software, crdt, distributed systems, offline-first, conflict resolution | A conference talk arguing that CRDTs make local-first apps practical, starting from the problem of offline edits. It includes a live demo of two devices merging a document without a server, and discusses trade-offs such as storage growth and tombstone garbage collection. | 913 / 133 | 2547 ms |
| ru-video | video | ru | postgresql, mvcc, vacuum, database internals, autovacuum | Видео объясняет, как PostgreSQL хранит версии строк и как каждая транзакция видит свой снимок данных. Также разбирается, почему таблица раздувается при долго открытой транзакции и как настроить автовакуум под нагрузку. | 924 / 137 | 1646 ms |
| en-repo | repo | en | job queue, sqlite, node.js, background jobs, message queue | tiny-queue is a durable background job queue for Node.js that stores jobs in a single SQLite file. It offers at-least-once delivery, retries with exponential backoff, scheduled jobs, and a small web dashboard, which makes it a lightweight option for projects that don't want to run a separate broker. | 953 / 147 | 2843 ms |
| ru-repo | repo | ru | rust, stemming, natural language processing, russian language, porter stemmer | ru-stemmer — это библиотека на Rust для стемминга русских слов, поддерживающая алгоритм Портера и словарные исключения. Она работает без аллокаций на горячем пути и распространяется под лицензией MIT, поэтому может быть полезна для поиска и обработки русского текста. | 910 / 154 | 2182 ms |
| en-tool | tool | en | diagrams, flowcharts, sequence diagrams, er diagrams, svg | Diagramly is a browser-based tool that turns plain text into sequence diagrams, flowcharts and ER diagrams, with options to share, embed or export to SVG. It is free for personal use and needs no sign-up, so it may be handy for documenting systems. | 896 / 139 | 1696 ms |
| ru-tool-banner | tool | ru | subtitles, translation, online tools | Бесплатный онлайн-сервис для перевода субтитров. Текст страницы содержит только уведомление о cookie, поэтому описание основано на URL и заголовке. | 861 / 99 | 1456 ms |

Total tokens: 7340 in / 1121 out. Failures: 0. Type or language mismatches: 0.

#### Findings

- Type and language match the expected values in all 8 cases. RU summaries are in Russian and EN
  summaries in English, as the prompt asks.
- Tags are lowercase English for both languages, 3 to 5 per link, and specific (`mvcc`,
  `porter stemmer`, `autovacuum`). This matches the prompt's
  "in English even when the content is in Russian" rule, so tags from RU and EN links share one
  vocabulary.
- The cookie-banner page (`ru-tool-banner`) still gets the right type and language. The summary
  says the page held only a cookie notice and falls back to the URL and title instead of inventing
  details.
- About 900 input and 100 to 160 output tokens per link, 1.5 to 3.5 s per call.

#### Prompt changes

None. The results show no problems, so `classify-link.ts` is unchanged and there is no
before/after comparison.

## Embeddings and full pipeline (Workers AI)

An opt-in check of embeddings against real Workers AI (`@cf/baai/bge-m3`), plus the full real
pipeline: `fetchContent` → `classifyLink` (real Anthropic) → `embeddingText` → Workers AI. Like the
classifier smoke test it is not part of `test` and never runs in CI.

### Running it

It needs the Anthropic key and a Cloudflare API token with Workers AI access. `.env` (copied from
`.env.example`) holds only `pass://` references:

```sh
ANTHROPIC_API_KEY=pass://Stash/Anthropic/api_key
CLOUDFLARE_ACCOUNT_ID=pass://Stash/Cloudflare/account_id
CLOUDFLARE_API_TOKEN=pass://Stash/Cloudflare/api_token
```

From the repo root:

```sh
PROTON_PASS_AGENT_REASON="stash embeddings smoke test" \
  pp run --env-file .env -- pnpm --filter @stash/backend-enrichment smoke:embed
```

The script (`packages/backend/enrichment/scripts/smoke-embed.ts`) calls the Workers AI REST API
(`POST /accounts/{account}/ai/run/@cf/baai/bge-m3`) through the platform `HttpClient` and wraps it
with `Ai.make`, so the same response decoding as the Worker binding runs. It checks:

- **Dimension**: every vector has `Ai.embeddingDimensions` (1024) values, the size the Vectorize
  index is created with.
- **Cross-language similarity**: 4 synthetic topics, each written once in RU and once in EN. Every
  same-topic RU ↔ EN pair must score a higher cosine than every pair of different topics (in any
  language). The same check runs on the pipeline's vectors, where the RU and EN Wikipedia articles
  on one topic must beat every unrelated pair.
- **Latency** per Workers AI call, and per step (fetch / classify / embed) in the pipeline.

It exits 1 if any call fails or any check fails. Credentials are read into `Redacted` values and
never printed. The account id is part of the request URL, so errors print only their tag or an
HTTP status, never the request or its cause.

### Results

Run on 2026-10-27 from the dev machine through `pp run` (exit 0). Latency is wall-clock from the
dev machine and includes network time. Output as printed by the script:

Embedding model: `@cf/baai/bge-m3`. Classifier: `claude-haiku-5-5`.

#### Synthetic texts

| text | dimension | latency |
|---|---|---|
| en-crdt | 1024 | 250 ms |
| ru-crdt | 1024 | 147 ms |
| en-rates | 1024 | 134 ms |
| ru-rates | 1024 | 114 ms |
| en-postgres | 1024 | 90 ms |
| ru-postgres | 1024 | 79 ms |
| en-sourdough | 1024 | 73 ms |
| ru-sourdough | 1024 | 101 ms |

Expected dimension (Vectorize index, `Ai.embeddingDimensions`): 1024. Latency per call: min 73 ms, median 114 ms, max 250 ms.

#### Cross-language similarity (synthetic)

| same-topic RU ↔ EN pair | cosine |
|---|---|
| en-crdt ↔ ru-crdt | 0.927 |
| en-rates ↔ ru-rates | 0.927 |
| en-postgres ↔ ru-postgres | 0.877 |
| en-sourdough ↔ ru-sourdough | 0.766 |

Highest unrelated pair: ru-crdt ↔ ru-postgres (0.517). Lowest same-topic pair: 0.766. Margin: 0.249. Cross-language check: PASS.

#### Full pipeline (fetch → classify → embed)

| page | fetched chars | type | lang | tags | dimension | fetch / classify / embed |
|---|---|---|---|---|---|---|
| en-wiki-postgres | 99985 | article | en | postgresql, relational databases, sql, open source software, database management systems | 1024 | 315 / 3228 / 128 ms |
| ru-wiki-postgres | 36849 | article | ru | postgresql, relational database, sql, database management system, open source | 1024 | 255 / 3426 / 112 ms |
| en-wiki-inflation | 99993 | article | en | macroeconomics, monetary economics, inflation, price index, economic history | 1024 | 961 / 1720 / 140 ms |
| ru-wiki-inflation | 35026 | article | ru | inflation, monetary economics, economics, money supply, deflation | 1024 | 1531 / 1951 / 132 ms |
| en-repo-effect | 4900 | repo | en | typescript, effect, functional programming, concurrency, dependency injection | 1024 | 1085 / 1344 / 150 ms |

#### Cross-language similarity (pipeline)

| same-topic RU ↔ EN pair | cosine |
|---|---|
| en-wiki-postgres ↔ ru-wiki-postgres | 0.824 |
| en-wiki-inflation ↔ ru-wiki-inflation | 0.838 |

Highest unrelated pair: en-wiki-postgres ↔ en-repo-effect (0.597). Lowest same-topic pair: 0.824. Margin: 0.227. Cross-language check: PASS.

Failed checks: 0.

#### Findings

- All 13 vectors have 1024 values, which matches the Vectorize index (`dimensions: 1024`).
- bge-m3 maps RU and EN text on one topic close together: 0.77 to 0.93 for the synthetic pairs and
  about 0.83 for the Wikipedia pairs, against at most 0.52 (synthetic) and 0.60 (pipeline) for
  unrelated pairs. Margins of about 0.25 and 0.23 mean a RU query should find EN links on the same
  topic and the other way round.
- The highest unrelated scores are between two technical texts (CRDT vs PostgreSQL, PostgreSQL vs
  the Effect repo), as expected for neighbouring topics.
- A Workers AI call takes about 70 to 250 ms. In the pipeline the classifier dominates (1.3 to
  3.5 s), and fetching takes 0.3 to 1.5 s.
- The classifier tags RU Wikipedia pages with English tags that overlap the EN page's tags
  (`postgresql`, `sql`, `monetary economics`), as the prompt asks.
