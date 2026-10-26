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

**Pending.** The live run has not happened yet because `pp` cannot open its local store on the dev
machine. Once it works, paste the script's output here. If the prompt in `classify-link.ts` needs
changes, record the output from before and after the change.

### Before prompt changes

_(pending)_

### After prompt changes

_(pending, only if the prompt changes)_
