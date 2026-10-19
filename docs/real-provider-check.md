# Real-provider check (RX-174, for RX-160)

Run on 2026-10-19 with the Tech Lead's capped keys, by `bun scripts/real-provider-check.ts` (run by hand from the repo root, never in CI). No key, header or env value is printed; `scripts/check-no-key-leak.ts` checks the output, this note and the diff.

Providers checked (hosts only):

| Role | Host | Setting |
|---|---|---|
| Primary (`LLM_BASE_URL`) | `9router.renovix.id` (a 9Router instance) | `LLM_API_KEY` set, `OPENROUTER_API_KEY` unset |
| Fallback (`LLM_FALLBACK_BASE_URL`) | `ai.sumopod.com` | `LLM_FALLBACK_API_KEY` set |
| Embeddings (`EMBEDDING_BASE_URL`) | `ai.sumopod.com` | `EMBEDDING_API_KEY` set, `EMBEDDING_MODEL=intfloat/multilingual-e5-large-instruct`, `EMBEDDING_DIMENSIONS=1024` |

`LLM_MODEL_ID_MAP` was `{"cc/claude-opus-5.5":"claude-opus-5.5"}`. Every provider had a key, so nothing was skipped.

## Findings for the Tech Lead

1. **The configured embedding model is refused.** `ai.sumopod.com` answers 400 `Invalid model name passed in model=intfloat/multilingual-e5-large-instruct`. Its `/models` lists `text-embedding-3-small`, `text-embedding-3-large` and `gemini/gemini-embedding-001`. With `EMBEDDING_MODEL=text-embedding-3-small` (set on the command line for the re-run), everything works (below).
2. **The `LLM_MODEL_ID_MAP` value is refused by both sides.** `claude-opus-5.5` gets 404 from the primary and 400 from the fallback. The ids each side lists are `cc/claude-opus-5-5` (primary) and `claude-opus-5-5` (fallback), with dashes, not a dot. Both answer 200.
3. **One map cannot serve both endpoints today.** The adapter applies `LLM_MODEL_ID_MAP` to the primary and the fallback alike (`toProviderModelId`). The primary needs `cc/claude-opus-5-5` and the fallback needs `claude-opus-5-5`, so no single value works for both. With our id `cc/claude-opus-5-5` and the map `{"cc/claude-opus-5-5":"claude-opus-5-5"}`, the fallback works and the primary would get the bare id, which it refuses (404). `.env.example` is unchanged.
4. **9Router turns an upstream 404 into 503.** `cc/claude-opus-5.5` (unknown upstream) gets 503 with the body `[claude/claude-opus-5.5] [404] ... Did you mean claude-opus-5-5?`. That 503 is in `FALLBACK_STATUSES`, so a wrong model id on the primary costs 6 attempts and about 59 s of back-off, then one fallback call.
5. **SumoPod's 401 body echoes part of the key.** With the fake key, the body contained `Received API Key = sk-...-000, Key Hash (Token) = <sha256>`, which is the key's last characters and its hash. The adapter logs `err.bodyText` on a stream error (`openrouter.adapter.ts:455-456`), so a wrong or revoked real fallback key would put its last characters and hash in the API log. This note shows only the fake key's mask.
6. **The adapter waits once more after its last attempt.** The 6th failed attempt still logs and waits (`Retrying in 15000ms`, 60000 ms for 429) before it gives up. The total wait before the fallback or the error is 59 s for 500/503 and 195 s for 429.

## Embeddings

`EmbeddingService.embed` (the real service, built with a `ConfigService` stand-in) sends `dimensions` from `EMBEDDING_DIMENSIONS`.

| Model | `dimensions` | Status | Result |
|---|---|---|---|
| `intfloat/multilingual-e5-large-instruct` (configured) | 1024 | 400 | refused: invalid model name |
| `text-embedding-3-small` | 1024 | 200 | 2 vectors, lengths 1024, 1024 |
| `text-embedding-3-small` | 768 | 200 | 2 vectors of 768: `dimensions` is **accepted**; `assertEmbeddingLength` throws `Embedding has 768 dimensions but knowledge_chunks.embedding is vector(1024)` |

**No row on 768:** this ran the real write path (`KnowledgeService.addChunks` with the real repositories) on a throwaway Postgres (`docker compose -p rx-174-eng`, `TEST_DB_PORT=55462`, migrations applied, removed afterwards with `down -v`):

- 768: `addChunks` threw, `knowledge_chunks` rows before 0, after 0. `assertEmbeddingLength` runs inside `embed()` (`embedding.service.ts:73`), and `addChunks` calls `insertChunks` only after `embed()` returns (`knowledge.service.ts:131` and `:134`).
- Control at 1024, same base: `inserted=2`, rows 0 → 2, so the count does move when a write happens.
- With the configured model, both calls were refused (400) and the rows stayed 0 → 0.

## Model ids: primary and fallback

One request each, sent directly: the adapter's body (`model`, one user message, `temperature` 0.7, `max_tokens` 16), no retry.

Configured map (`{"cc/claude-opus-5.5":"claude-opus-5.5"}`):

| id | primary (`9router.renovix.id`) | fallback (`ai.sumopod.com`) | error excerpt |
|---|---|---|---|
| `claude-opus-5.5` (map value, sent) | 404 | 400 | primary: `No active credentials for provider: anthropic` (`model_not_found`); fallback: `Invalid model name passed in model=claude-opus-5.5` |
| `cc/claude-opus-5.5` (map key, never sent) | 503 | 400 | primary: `[claude/claude-opus-5.5] [404] ... model: claude-opus-5.5 was not found. Did you mean claude-opus-5-5?`; fallback: invalid model name |
| `renovix/not-a-model` (negative control) | 404 | 400 | primary: `No active credentials for provider: renovix`; fallback: invalid model name |

Listed ids (map `{"cc/claude-opus-5-5":"claude-opus-5-5"}`, set on the command line for the re-run):

| id | primary | fallback | note |
|---|---|---|---|
| `claude-opus-5-5` | 404 | **200** | fallback answer "ok", usage 18/4 |
| `cc/claude-opus-5-5` | **200** | 400 | primary answer "ok", usage 2042/4 |
| `renovix/not-a-model` | 404 | 400 | refused by both |

`GET /models` lists the accepted ids. Primary (96 ids): `cc/claude-opus-5-5`, `cc/claude-opus-5`, `cc/claude-opus-4-8`, `ag/claude-opus-5-5` (and `-low`, `-medium`, `-high`), `griphub-router/claude-opus-5.5`, etc. Fallback (65 ids): `claude-opus-5-5`, `claude-opus-5`, `claude-opus-4-8`. Neither reports prices on `/models`.

## Wrong key

Fixed fake key `sk-renovix-wrong-key-000`, not derived from any real key.

- Real `OpenRouterAdapter` (primary key replaced by the fake one, real fallback configured): `ProviderHttpError 401` `{"error":"API key required for remote API access"}`. Fallback requests: 0. The line "sending the request once to the fallback" was **not** logged.
- Sent directly to the fallback: 401 (`Authentication Error, Invalid proxy server token passed`).

## Fallback statuses (local stub as the primary)

The real adapter ran with `LLM_BASE_URL` set to a `node:http` stub on 127.0.0.1. The stub only answers a status, forwards nothing, and receives a placeholder key, never the real one. The fallback is the real `ai.sumopod.com`, our id is `cc/claude-opus-5-5`, and it is sent as `claude-opus-5-5`. The back-off waits were shortened to 1 ms each and the requested waits were recorded, so the 429 case stays fast. It also cost nothing: every 429 attempt went to the local stub and none reached a real host.

| Primary answer | Primary calls | Back-off requested (ms) | Fallback requests | Fallback log line | Caller gets |
|---|---|---|---|---|---|
| 503 | 6 | 2000, 4000, 8000, 15000, 15000, 15000 | **1** | 1 | the fallback's answer "ok" (18/4 tokens) |
| 502 | 1 (D156: fallback configured, no back-off) | none | **1** | 1 | the fallback's answer "ok" (18/4 tokens) |
| 500 | 6 | 2000, 4000, 8000, 15000, 15000, 15000 | 0 | 0 | `ProviderHttpError 500` |
| 504 | 1 | none | 0 | 0 | `ProviderHttpError 504` |
| 429 | 6 | 5000, 10000, 20000, 40000, 60000, 60000 | 0 | 0 | `ProviderHttpError 429` |
| connection refused (closed port) | n/a | none | 0 | 0 | `Error: Unable to connect. Is the computer able to access the url?`: **no fallback today (item 24)** |

In the first run, with the configured map, 503 and 502 also went to the fallback exactly once. The fallback answered 400 (invalid model name), and that error reached the caller.

## Outage statuses each provider documents

- **9Router** (`9router.renovix.id`): not documented. The project README ([github.com/decolua/9router](https://github.com/decolua/9router)) documents the model-id prefixes (`cc/`, `cx/`, `gh/`, ...) but no HTTP statuses for upstream failures. Observed: 503 for an upstream 404 (finding 4), 404 `model_not_found` for a provider it has no credentials for, and 401 for a wrong key.
- **SumoPod** (`ai.sumopod.com`): not documented. I found no public API reference: `ai.sumopod.com/docs` and the site root answer 404 to an unauthenticated fetch, and a web search found only third-party SDK READMEs (e.g. [pi-sumopod-connector](https://cdn.jsdelivr.net/npm/pi-sumopod-connector@1.2.2/README.md)). Observed: 400 for an unknown model, and 401 for a wrong key.
- Whether `dimensions` is documented: not documented by SumoPod. It is observed to be accepted for `text-embedding-3-small`.

## Requests and spend

Real requests sent, over one full run and four partial re-runs (embeddings twice, model ids, proxy):

| Host | Requests | Of which answered 200 and billed | Tokens reported |
|---|---|---|---|
| `ai.sumopod.com` | 24 (4 of them `GET /models`) | 3 chat + 2 embeddings | chat 54 prompt / 12 completion; embeddings 12 |
| `9router.renovix.id` | 9 (2 of them `GET /models`) | 1 chat | 2042 prompt / 4 completion |

The local stub got 40 calls and the closed port 2 attempts; none of them left the machine. Neither provider reports prices. At Anthropic's list price for Claude Opus 5.5 ($4 / $20 per million tokens, used only as a ceiling), the chat traffic comes to about $0.0005 on SumoPod and $0.0082 on 9Router. The `cc/` route is a Claude Code subscription, so it is probably not billed per token. The embeddings are negligible. Total: under $0.01.

## How to re-run

```bash
# Optional: a throwaway database for the write-path check
TEST_DB_PORT=55462 docker compose -f docker-compose.test.yml -p rx-174-eng up -d --wait
DATABASE_URL=postgresql://renovix:renovix_test@127.0.0.1:55462/renovix_test bunx prisma migrate deploy
CHECK_DATABASE_URL=postgresql://renovix:renovix_test@127.0.0.1:55462/renovix_test bun scripts/real-provider-check.ts all >| out.txt
bun scripts/check-no-key-leak.ts out.txt
docker compose -f docker-compose.test.yml -p rx-174-eng down -v
```

The sections are `embeddings`, `models`, `wrong-key` and `proxy`. A non-secret setting such as `EMBEDDING_MODEL` or `LLM_MODEL_ID_MAP` can be set on the command line, and it overrides `.env`. `CHECK_MODEL_ID` picks our model id for the adapter checks; it defaults to the first map key. The script refuses any `CHECK_DATABASE_URL` that is not on localhost or whose name does not end in `_test`.
