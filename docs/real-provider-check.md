# Real-provider check (RX-174, for RX-160)

Run on 2026-10-19 with the Tech Lead's capped keys, by `bun scripts/real-provider-check.ts`. It is run by hand from the repo root, never in CI. The repository is public, so this note names provider roles (primary, fallback, embedding provider) and gives results in generic terms only (D196). The full results, with provider hosts, model ids per provider and the detailed findings, are on the Notion page "RX-174 real-provider check (full results)" under Agent Reports, linked from the RX-174 ticket.

## Setup

- **Providers.** A primary chat provider (`LLM_BASE_URL`), a fallback chat provider (`LLM_FALLBACK_BASE_URL`), and an embedding provider (`EMBEDDING_BASE_URL`). All three had a key, so no section was skipped.
- **Key handling.** The keys came from the Tech Lead's local `.env`, which Bun loads into the script's process. No agent opened, printed or searched that file. Every line the script prints goes through `redact()`. It replaces:
  - the value of every environment variable whose name matches `KEY|TOKEN|SECRET|PASSWORD`;
  - any `Bearer` credential;
  - an echoed `Received API Key = …` and any 64-hex key hash.
- **Leak check.** `scripts/check-no-key-leak.ts` reports, by variable name only, whether a secret value, its last 6 characters or its SHA-256 appears in the given files. A planted value is the positive control.

## Results per acceptance criterion

| AC | Result |
|---|---|
| Embeddings at 1024 | The configured embedding model was **refused** (400, unknown model). With a model the provider lists: 200, two vectors of length 1024. The configured value is reported to the Tech Lead. |
| Embeddings at 768 (negative) | The provider **accepts** `dimensions`. `assertEmbeddingLength` throws in the real `KnowledgeService.addChunks` path (throwaway DB), and `knowledge_chunks` stays 0 → 0. A 1024 control writes 0 → 2, so the count does move. |
| Each `LLM_MODEL_ID_MAP` value → 200 | The configured map value was **refused by both sides** (404 primary, 400 fallback). Each side lists an accepted id for the same model, but the two ids differ. With those ids, each side answers 200. |
| Id table, primary vs fallback | See the table below. The negative control `renovix/not-a-model` is refused by both sides. |
| Wrong key (negative) | 401. The adapter does not fall back: 0 fallback requests, and the "sending the request once to the fallback" log line is absent. |
| Primary 502 / 503 (local stub) | Exactly one fallback call, and the fallback's answer reaches the caller. 503: 6 primary attempts with back-off first. 502: 1 attempt (D156). |
| Primary 500 / 504 / 429 (local stub) | No fallback; the error reaches the caller. At adapter level the caller gets the `ProviderHttpError`; the error event to the chat client and the API process staying up are covered by the RX-169 specs. |
| Primary unreachable (connection refused) | **No fallback today.** The error reaches the caller. Recorded for item 24. |
| Documented outage statuses | Not documented by either chat provider. |
| No key in output, note or diff | `check-no-key-leak` over the commit, this note and every run output: every secret variable "not found". The planted control was found. |

### Model ids, primary vs fallback (generic)

| id | primary | fallback |
|---|---|---|
| the configured map value | 404 | 400 |
| the id the primary lists | 200 | 400 |
| the id the fallback lists | 404 | 200 |
| `renovix/not-a-model` (negative control) | 404 | 400 |

The adapter sends the same mapped id to the primary and the fallback, so with today's providers one `LLM_MODEL_ID_MAP` cannot serve both. This is input for per-provider model ids (RX-178).

### Fallback behaviour (local stub as the primary, real fallback)

| Primary answer | Primary calls | Fallback requests | Caller gets |
|---|---|---|---|
| 503 | 6 | 1 | the fallback's answer |
| 502 | 1 | 1 | the fallback's answer |
| 500 | 6 | 0 | `ProviderHttpError 500` |
| 504 | 1 | 0 | `ProviderHttpError 504` |
| 429 | 6 | 0 | `ProviderHttpError 429` |
| connection refused | n/a | 0 | a network error (item 24) |

The stub only answers a status: it forwards nothing and receives a placeholder key. Back-off waits were shortened to 1 ms each and the requested waits recorded, so the 429 case cost nothing. The adapter still waits once more after its last failed attempt; that is reported to the Tech Lead.

## Findings for the Tech Lead

The details are on the Notion page.
- The configured embedding model and the configured map value are not accepted by today's providers. Neither `.env.example` nor any code default is changed here (D193).
- One map value cannot serve both endpoints (above).
- A wrong model id on the primary can come back as 503, which triggers retries and a fallback call.
- One provider's 401 body echoes part of the key. See RX-190.
- The extra back-off after the last attempt is tracked in its own ticket.

## Requests and spend

- 33 real requests (6 of them `GET /models`).
- Billed: 4 chat completions and 2 embedding calls, about 2,100 prompt tokens and 16 completion tokens in total.
- The local stub got 40 calls and the closed port 2 attempts; none left the machine.
- Total spend: under $0.01.

## How to re-run

```bash
# Optional: a throwaway database for the write-path check
TEST_DB_PORT=55462 docker compose -f docker-compose.test.yml -p rx-174-eng up -d --wait
DATABASE_URL=postgresql://renovix:renovix_test@127.0.0.1:55462/renovix_test bunx prisma migrate deploy
CHECK_DATABASE_URL=postgresql://renovix:renovix_test@127.0.0.1:55462/renovix_test bun scripts/real-provider-check.ts all >| out.txt
bun scripts/check-no-key-leak.ts out.txt
docker compose -f docker-compose.test.yml -p rx-174-eng down -v
```

- **Sections:** `embeddings`, `models`, `wrong-key` and `proxy`.
- **Overrides:** a non-secret setting (`EMBEDDING_MODEL`, `LLM_MODEL_ID_MAP`) can be set on the command line, and it overrides `.env`. `CHECK_MODEL_ID` picks the model id for the adapter checks.
- **Database guard:** the script refuses a `CHECK_DATABASE_URL` that is not on localhost or whose name does not end in `_test`.
