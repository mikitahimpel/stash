# Enrichment classifier smoke test

An opt-in check of `classifyLink` (`packages/backend/enrichment/src/classify-link.ts`) against the
real Anthropic API (`claude-haiku-5-5`). It is not part of `test` and never runs in CI. Unit tests
keep using the fake `LanguageModel`.

## Running it

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

## Results

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

### Findings

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

### Prompt changes

None. The results show no problems, so `classify-link.ts` is unchanged and there is no
before/after comparison.
