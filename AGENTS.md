# AGENTS.md

## Project

Renovix AI -- unified AI platform (multi-LLM API + chat portal + back-office + landing page). Credit-based billing, RAG knowledge base, AI agents, MCP integrations. Production domain: `renovix.id`.

> The npm scope is `@performa-ai` but the product brand is **Renovix AI**. Repo: GitHub `farrelfauzan/renovix-ai`. Plan, tickets and decisions: [Renovix AI project in Notion](https://app.notion.com/p/3f352ed08ee2811daafefab59f5512bb). Product direction for billing: `docs/billing-direction.md`.

## Monorepo Layout

Nx 22 monorepo. Package manager: **Bun** (Docker builds fall back to npm with `--legacy-peer-deps`).

| Path | What | Framework | Dev port |
|------|------|-----------|----------|
| `apps/api` | Backend API | NestJS 11 + **Fastify 5** (not Express) | 3000 |
| `apps/chat` | Chat portal | Next.js 16 (App Router) | 4300 |
| `apps/back-office` | Staff back-office (shell: navigation + placeholder pages; no Dockerfile yet); shares no code with chat/landing | Next.js 16 (App Router) | 4400 (`ADMIN_ORIGIN`) |
| `apps/landing` | Landing page | Next.js 16 (App Router) | 3001 (Docker); `nx dev` does not pin a port |
| `apps/api-e2e` | API E2E tests | Jest + SWC | -- |
| `prisma/` | Schema + 39 migrations + seed | Prisma 7 + pgvector | -- |
| `infra/` | Terraform IaC (7 modules), kept for reference (see Infrastructure & Deploy) | GCP, >= Terraform 1.7 | -- |
| `docs/` | Strategy/design docs; finished ones are in `docs/archive/` | Markdown | -- |

No `libs/` packages exist yet.

## Dev Commands

```bash
# Infrastructure (PostgreSQL + MinIO)
docker compose up -d

# Development
bun run dev:api          # API on localhost:3000
bun run dev:chat         # Chat on localhost:4300
bun run dev:back-office  # Back-office on localhost:4400
bun run dev:landing      # Landing page
bun run dev:all          # All apps in parallel

# Build
bun run build:api
bun run build:chat
bun run build:back-office
bun run build:landing

# Prisma (MUST run generate before building API)
bun run prisma:generate  # Outputs to apps/api/src/generated/prisma (gitignored)
bun run prisma:migrate   # Dev migrations
bun run seed             # RNX-91: fresh-environment seed, idempotent: tier rates, agent templates (skipped until an admin has entered a model), system prompts, offer catalog + plans, system-knowledge sync. Refuses NODE_ENV=production without --allow-production (Tech Lead only). SEED_OPERATOR=<name> names the change records (default "seed").
bun run prisma:reset     # Reset (drops all data); then run `bun run seed`
bun run prisma:seed      # Only the system prompt and prompt templates (prisma/seed.ts); use `bun run seed` for everything
SEED_OPERATOR=<name> bun run seed:offers  # Offer catalog + platform settings from prisma/offers.seed.json (RX-86)
SEED_OPERATOR=<name> bun run seed:tier-rates  # Tier credit rates from prisma/tier-rates.seed.json (RX-21); run after prisma:reset
# RX-90: prisma/migrations is one baseline (20261014200000_baseline); migrations insert no plans,
# prices or limits (those come from the catalog seed, RX-86). A local database created before
# RX-90 must be recreated: `bun run prisma:reset` (drops all its data, then migrates and seeds).

# Nx targets (alternative)
nx run api:prisma-studio  # Visual DB browser
nx run api:test          # Needs TEST_DATABASE_URL, see docs/testing.md
nx run api-e2e:e2e       # dependsOn api:build and api:serve
```

## Critical Gotchas

- **Prisma client output is gitignored** at `apps/api/src/generated/prisma`. Always run `bun run prisma:generate` after cloning or changing the schema before building the API.
- **Fastify, not Express** -- the API uses `@nestjs/platform-fastify`. Do not import Express-specific middleware or use Express request/response types.
- **Global API prefix** is `/api` with URI versioning defaulting to `/v1`. All routes resolve to `/api/v1/...` except health (`/api/health` is version-neutral).
- **Dual auth system** -- JWT Bearer tokens (legacy) + Better Auth sessions (SSO via Google/GitHub). `CombinedAuthGuard` tries JWT first, falls back to session cookie. Portal endpoints use `X-Portal-Session` header.
- **Every route declares `@Access`** (RX-114, `apps/api/src/common/decorators/access.decorator.ts`): the accepted methods (`auth: ["jwt", "session"]`, `["apiKey"]`, `["portal"]`) or `public: true` with a `reason`. The global `AccessGuard` denies a route without it (403); no `@UseGuards` for authentication. `apps/api/src/app/app.module.access.spec.ts` fails on a route that breaks this.
- **Body limit differs by env** -- dev: 50MB, production: 1MB (configured in `apps/api/src/main.ts`).
- **TypeScript build errors are ignored** in all Next.js apps (`ignoreBuildErrors: true` in next.config). The build will succeed even with TS errors.
- **No ESLint or Prettier** is configured. No lint step exists.
- **Two webpack configs for API** -- `webpack.config.js` (Nx dev serve) and `webpack.docker.config.js` (Docker production build with ts-loader).
- **`NEXT_PUBLIC_API_URL`** is a build-time arg baked into the chat Docker image (default `https://api.renovix.id`). Without it the chat app falls back to `http://localhost:3000/api/v1`.

## API Architecture

- 21 modules (`*.module.ts`) in `apps/api/src/app/`, plus the root `AppModule`; `AppModule` imports 20 of them, `MemoryModule` is imported by `ChatModule` and `PortalModule`
- Request validation: Zod schemas parsed manually with `safeParse` in the controllers; `nestjs-zod` is used by the OpenAPI generator (its zod→OpenAPI 3.0 schema rewrite, RX-170). A request body is a `@Body() body: unknown` parameter parsed with the module's `dto/` schema; an invalid body is refused with `createInvalidBodyException(parsed.error)` (`apps/api/src/common/utils`), the one 400 shape `{ error: { message: "Invalid request body", type: "invalid_request_error", details } }` (RNX-28). `bun run check` enforces it (step "request bodies", `scripts/check-request-bodies.ts`)
- Path alias: `@generated/prisma` -> `./src/generated/prisma`
- OpenAI-compatible endpoint: `POST /api/v1/chat/completions` (API key auth via `ApiKeyGuard`)
- SSE streaming for chat completions and document generation
- OpenAPI docs: two generated, committed documents under `docs/openapi/` (`backoffice.openapi.json`, `portal.openapi.json`), generated from the code by `bun run openapi:generate` (a Jest spec that scans `AppModule` in preview mode). A drift check fails the API tests when a route is in neither document nor on the exclusion list (`/webhooks/*`, health, root). Served by `docker compose up docs-backoffice docs-portal` on 127.0.0.1:8081 (back office) and 127.0.0.1:8082 (portal) — not by the API (no Swagger UI at `/api-docs` anymore)
- Rate limiting: global 60 req/60s via `ThrottlerGuard`
- AI provider routing: `ProviderRouter` -> adapters (currently only `OpenRouterAdapter`, provider key `openrouter`; chat models and embeddings go through OpenRouter)
- Provider records (RX-177, D148, D149): `apps/api/src/app/admin-providers/`, API only (screen RX-102). `/admin/providers` (`providers:read` / `providers:write`) and `/admin/providers/:providerId/models` (`models:read` / `models:write`); every write is audited. A provider (`9router` or `openai_compatible`) is created inactive, tested (`POST /:id/test` with `{ slug }`: one minimal request through `ProviderRouter.testConnection`, outside the credit path, the fake in `LLM_PROVIDER=fake`), then activated; a new key or base URL clears the test and sets the provider inactive (D195), and a new base URL needs the key in the same PATCH (D197). The key is stored only encrypted (`LLM_KEY_ENCRYPTION_KEY`) and never returned. A model's slug is the provider's own model id, unique across providers and never changed. Every chat call is resolved from its slug to the model's provider record (RX-178, D199): `ModelRegistryService.resolveConnection` gives the record's base URL and key (cached sealed, opened per call through `ProviderRepository`) and the slug is sent as `model`; an unknown slug, a model without a provider record, or an inactive or deleted provider is a 400 with a fixed text, before any credit is reserved. A provider write that takes it out of service clears its models from the handling process's cache at once (other instances within the 60 s refresh). `ai_models.provider` / `provider_id` are no longer read for routing. In `LLM_PROVIDER=fake` the resolution is skipped
- Prompt tuning: keyword-based intent matching on `PromptTemplate` injects specialized system prompts
- Document generation: detects output format from prompt templates, converts markdown to PDF/DOCX/XLSX, uploads to S3

### API module layout

- A feature module is every folder of `apps/api/src/app/` except `prisma`, `config`, `providers` and `google-storage` (18 today).
- Code shared by the modules lives in `apps/api/src/common/`, in a folder named for its kind (today: `guards/`, `decorators/`, `types/`, `utils/`; `access.module.ts` at its root). A folder is created when its first file arrives.
- Inside a feature module, files are arranged by layer: `controller/`, `service/`, `repository/` (today: codes), `dto/`. A file of another kind goes into a folder named for its kind (today: `guard/`, `scheduler/`, `strategy/`, `converter/`, `config/`, `utils/` for helpers, `types/`).
- Only the `<module>.module.ts` file stays at the module root.
- A test file sits in the folder of the file it tests; a test that covers several files sits next to its main subject (HTTP tests in `controller/`).
- `bun run check` enforces it (step "module layout", `scripts/check-module-layout.ts`): it fails and names any source file that lies directly in a feature module folder, and any controller file that defines a Zod schema inline (`z.object`) — request schemas live in the module's `dto/` folder (RX-184, decision 2a).
- Code rules: `.claude/rules/nestjs-clean-typescript.md` and `.claude/rules/nextjs-frontend.md` (tracked in git).

### Helpers

- A helper is a function that passes three tests: (1) it uses nothing injected (never uses `this`); (2) plain values in, plain values out: no database, network or file, nothing like a client or transaction passed in, no `await`, no clock, randomness or environment; (3) it is not an entry point (route handler, guard `canActivate`, sign-in strategy `validate`, interceptor, lifecycle hook, scheduled job).
- A helper does not stay in a service, controller, guard or scheduler file. It goes into the `utils/` folder of its module, one function per file, the file named for the function in kebab-case (`billing/utils/estimate-cost.ts` exports `estimateCost`), with its test beside it.
- The module that owns a helper keeps it, and other modules import it from there (chat and portal import the billing helpers from `billing/utils/`). Identical copies with no owner go to `apps/api/src/common/utils`.
- `bun run check` enforces test 1 (step "helper rule", `scripts/check-helper-rule.ts`): in those files (`*.service.ts`, `*.controller.ts`, `*.guard.ts`, `*.scheduler.ts` of `apps/api/src`) it fails and names any class method that never uses `this`, and any function written outside a class at the top level of the file (`function f`, or `const f =` an arrow function or function expression, exported or not), unless `scripts/helper-rule-exceptions.ts` lists it with its reason (it fails test 2 or 3, a named ticket will move it, or moving it would be a change outside the helper move, such as emptying an injected class). Keys: `<file> Class.method` and `<file> function`. A list entry that matches nothing any more fails too, so the list can only shrink. What the check does not read is listed in the header of the script.

### Repositories

- New code reaches the database only through a repository: `<module>/repository/<table>.repository.ts`, an injectable class that takes `PrismaService` (unless every method needs `tx`). Only repositories and the Prisma module (`apps/api/src/app/prisma/`) import `PrismaService` or the generated Prisma client; `import type` from the generated client is allowed everywhere. Controllers, guards and schedulers use services, never repositories.
- A repository holds queries only. Its methods are named for the operation (`findRedemption(codeId, userId)`), take the user or workspace as a required argument and return Prisma's generated types. A service never builds a query condition; who may do what stays in the service. Raw SQL lives only in repositories.
- Every repository method takes the transaction (`DbTransaction`) as its last argument: optional, and required on a method that changes a balance or writes a ledger or redemption row. A service runs several repository calls in one transaction with `TransactionService.run(work, options?, tx?)`; given `tx` it joins that transaction. Both come from the Prisma module. Never keep a transaction open across a model call or a stream.
- `PrismaService` carries the default filter for soft-deleted rows (today: `Provider`, RX-177). It covers top-level reads only: a relation in `include` or `select`, `_count`, a relation filter, raw SQL and every write need the condition written in the repository.
- `bun run check` enforces the import rule (step "prisma imports", `scripts/check-prisma-imports.ts`). `scripts/prisma-import-exceptions.ts` lists the files not moved yet; it may only shrink, never add a file to it.
- Four rules (RX-148), examples in `docs/repository-layer.md`, section "Where repositories live":
  1. One repository per table, not per module (D100). The codes module uses six: `InvitationCodeRepository`, `CodeRedemptionRepository`, `UserSubscriptionRepository`, `SubscriptionPlanRepository`, `TransactionRepository`, `UserRepository`. A method that also reads a second table through `include` goes to the repository of the table it is called on (`InvitationCodeRepository.findCodeWithPlan`).
  2. No value import of the generated Prisma client outside repositories; services write enum values as strings (`status: "active"`); a repository turns a Prisma error into one of the app's error classes, which are Nest's HTTP exceptions (D101, D103). Example: `AdminUserRepository.updateRole` turns `P2003` into `BadRequestException("Unknown role")`; of the six repositories the codes module uses only `UserSubscriptionRepository.createSubscription` maps one (`P2002` into a 409, RX-181).
  3. A table used by several modules has its repository in the module that owns the table: `invitation_codes` and `code_redemptions` in codes; `user_subscriptions`, `subscription_plans`, `transactions`, `credit_accounts`, `credit_ledger_entries` and `credit_reservations` in billing; `users` in auth; `portal_sessions` and `anonymous_usage_counters` in portal; `agents`, `agent_tools`, `agent_integrations`, `agent_knowledge_bases` and `agent_channels` in agent; `channels`, `channel_agents`, `channel_messages` and `channel_chat_rooms` in channel; `conversations`, `messages`, `prompt_templates` and `system_prompts` in chat; `reminders` in reminder; `knowledge_bases` in knowledge; `user_memories` in memory; `workspaces` and `workspace_memories` in workspace (RX-141). One global module, `RepositoriesModule` (`apps/api/src/app/prisma/repositories.module.ts`), provides and exports every repository; `AppModule` imports it once and a new repository is added to its list. A feature module lists no repository in its `providers` and never imports another module to get one (D103).
  4. "Fewer than 10 public methods" is a number the pull request reports for each repository it adds or grows, with a reason when it is above 10; it is not a hard limit (D103).
- In tests `createTestModule` imports `RepositoriesModule`, so a test lists only the service it tests. Pilot: `apps/api/src/app/codes/`. Rules, decisions and measurements: `docs/repository-layer.md`.

## Database

- PostgreSQL 16 with pgvector extension (1024-dim embeddings for knowledge base)
- Prisma adapter: `@prisma/adapter-pg` (pg driver-based, not default Prisma engine)
- Schema at `prisma/schema.prisma` (63 models)
- Model naming: PascalCase in schema, snake_case tables via `@@map`
- MCP credentials encrypted with AES-256-GCM (`MCP_ENCRYPTION_KEY` env var); provider keys too (`LLM_KEY_ENCRYPTION_KEY`, RX-177)
- Dev DB: `postgres://performa:performa_dev@localhost:5432/performa_ai` (from docker-compose)

## Offer catalog and platform settings (RX-86)

- Design: `docs/credits.md` section 9. Code: `apps/api/src/app/offers/` (services, no route yet: screens RX-98, checkout RX-35, enforcement RX-76). Migration `20261015150000_offer_catalog`.
- Packages, top-up packs and Enterprise bundles are rows; their price, credits and limits live on **versions**. A change creates the next version, never an edit: the database refuses UPDATE and DELETE on version rows, on `purchase_snapshots` (what a buyer bought, copied from the version, D37) and on `catalog_changes` (append-only triggers; TRUNCATE stays allowed for the tests).
- Platform settings (`platform_settings`) are typed: each name has a Zod schema in `offers/config/platform-settings.ts`, checked on every write; an unknown name or an invalid value is refused and nothing is written. A setting without a row is not set.
- Every write to a catalog row, a contract or a setting writes a `catalog_changes` row in the same transaction: who (admin id, or `seed:<operator>`), why, when it takes effect, values before and after.
- Values come only from `prisma/offers.seed.json`, which the Tech Lead edits; no price, credit amount or limit is written in code. `SEED_OPERATOR=<name> bun run seed:offers [file]` validates the file and applies it in one transaction to the database `DATABASE_URL` names; running it again with the same file writes nothing, changed terms create a new version. null or a missing entry means not decided yet and writes nothing.
- Tier credit rates (RX-21) come only from `prisma/tier-rates.seed.json`: `SEED_OPERATOR=<name> bun run seed:tier-rates`. Deploy: run it right after `prisma migrate deploy`, before traffic reaches the new build; until then every chat/portal completion returns 400 ("No credit rates found for tier"). Local devs run it after `prisma:reset`. The API caches tier rates for 60 seconds per process, so a changed rate reaches the next request within 60 seconds.
- `SubscriptionPlan`, `UserSubscription` and `InvitationCode` are unchanged and still read by the live code (`agent.service.ts` and `codes.service.ts`, through `SubscriptionPlanRepository`, `UserSubscriptionRepository` and, in codes, `InvitationCodeRepository`); `prisma/seed.ts` still seeds the old plans. Retiring them is later work.

## Frontend Patterns

Describes `apps/chat` (the only app with real UI besides `apps/landing`):

- Dark mode only (`className="dark"` on `<html>` in chat and landing)
- shadcn/ui components in `apps/chat/src/components/ui/` (new-york style, Radix primitives)
- Tailwind CSS v4 via `@tailwindcss/postcss` plugin (chat, landing)
- State: Zustand (persisted to localStorage) + TanStack React Query
- Auth: `better-auth/react` client for SSO, custom JWT for legacy
- Axios interceptors auto-strip responses to `.data` and inject auth headers
- Portal session: UUID stored in localStorage (`portal_session`), sent as `X-Portal-Session`

## Infrastructure & Deploy

- **Deployment target is under review** (Tech Lead decision D49: AWS or Railway, not decided). The old GCP production is retired. Do not deploy and do not push version tags.
- **`infra/`** (Terraform for GCP) and the GCP files (`.github/workflows/deploy.yml`, `cloudbuild.yaml`, `toggle-*.bash`, `docs/GCP_DEPLOYMENT_*.md`, `docs/CICD_STRATEGY.md`) are kept for reference only. The GCP setup had region `asia-southeast2`, Terraform state in GCS bucket `renovix-ai-terraform-state`, and modules networking, database, storage, security, oauth, cloud-run, cdn.
- **Deploy workflow** (GCP, retired): a `v*` tag runs `.github/workflows/deploy.yml` (`v<semver>` all apps, `v<semver>-<app>` one app).
- **CI** (PRs/push to main, `.github/workflows/ci.yml`): Docker build validation only -- no tests or lint in pipeline
- **Docker builds**: multi-stage, non-root user, `dumb-init` PID 1, build context is always monorepo root; the API image installs with `npm --legacy-peer-deps` and runs `prisma generate` in the image

## Testing

- Jest 30. API tests use ts-jest, `api-e2e` uses SWC. No tests run in CI currently.
- API tests: `nx run api:test`. Database tests need `TEST_DATABASE_URL`; setup, safety rules, factories and the fake LLM provider are in `docs/testing.md`.
- API E2E tests: `nx run api-e2e:e2e` (its `dependsOn` builds and serves the API)
- Landing tests: Jest + jsdom (`nx run landing:test`)
- The Playwright plugin is registered in `nx.json`, but no Playwright config or spec exists in the repo yet

## Environment

Copy `.env.example` to `.env` and keep all six `S3_*` keys in it: the API stops at boot with "Configuration key S3_BUCKET does not exist" when one is missing. Empty values boot, except `S3_REGION`, which must not be empty ('Region is missing'); uploads fail with empty values. `.env.example` points them at the local MinIO of `docker-compose.yml` (development only, never put real keys there):

- `S3_BUCKET`: the bucket that stores uploaded files (`performa-ai`, created by `minio-init`).
- `S3_REGION`: the bucket's region (`ap-southeast-1`).
- `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`: the credentials (MinIO root user `minioadmin`/`minioadmin`).
- `S3_ENDPOINT`: the S3 API URL (`http://localhost:9000`); optional, leave it out for AWS S3.
- `S3_CDN_DOMAIN`: the host that replaces the storage host in signed download URLs; empty (as locally) keeps the signed URL as it is.

Local uploads do not work until RNX-65 replaces the MinIO images, which no longer pull anonymously (Tech Lead, 2026-10-20).

`ADMIN_JWT_SECRET` and `ADMIN_TOTP_ENCRYPTION_KEY` have no default in `.env.example`: generate both before the first start with the `openssl` commands written above them there (`openssl rand -base64 48` and `openssl rand -base64 32`), or the API stops at boot.

Key variables:

`JWT_SECRET`, `BETTER_AUTH_SECRET`, `IP_HASH_SECRET`, `MCP_ENCRYPTION_KEY`, `MCP_OAUTH_STATE_SECRET`, `LLM_KEY_ENCRYPTION_KEY` and `API_KEY_HASH_SECRET` are required in every mode (RX-110, RX-151, RX-177, RNX-18, `apps/api/src/common/utils/assert-required-secrets.ts`). With `NODE_ENV` development or test the dev-only values of `.env.example` are accepted; any other `NODE_ENV`, unset included, is production: the API refuses to start on a missing, placeholder or shorter-than-32-character value, or an `MCP_ENCRYPTION_KEY` or `LLM_KEY_ENCRYPTION_KEY` that is not 32 bytes.

| Variable | Required | Notes |
|----------|----------|-------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `JWT_SECRET` | Yes | Legacy auth signing |
| `BETTER_AUTH_SECRET` | Yes | SSO session signing; no fallback (RX-110) |
| `ADMIN_JWT_SECRET` | Yes | Signs the back-office access token (RX-94); no fallback, the API does not start without it. At least 32 characters and never the same as `JWT_SECRET`; generate with `openssl rand -base64 48` |
| `ADMIN_TOTP_ENCRYPTION_KEY` | Yes | AES-256-GCM key for the back-office admins' TOTP secrets at rest (RX-94); no fallback. 32 bytes, base64; generate with `openssl rand -base64 32` |
| `ADMIN_ORIGIN` | Yes | The back-office app's own origin (RX-156), e.g. `https://admin.renovix.id`; locally `http://localhost:4400`. Every `/admin` route answers 403 to any other `Origin` (the product apps' included) and to a POST/PUT/PATCH/DELETE without `Origin`. Exactly one origin (no path, no trailing slash); no fallback, the API does not start without it. Separate from `CORS_ORIGIN` (the product origins), but in production the API adds it to the CORS allow-list as well (D141) |
| `IP_HASH_SECRET` | Yes | HMAC key for client IPs (free-tier caps); raw IPs are never stored |
| `API_KEY_HASH_SECRET` | Yes | HMAC key of the users' API keys (RNX-18): a key is stored only as its prefix and its HMAC-SHA256, never in plain text. Generate with `openssl rand -base64 48`; changing it makes every stored key stop working |
| `CLIENT_IP_HEADER` | Prod | Header carrying the client IP (e.g. `x-client-ip`); a trusted proxy in front of the API must set it and overwrite client copies. Unset locally (socket address). better-auth reads the same header (RNX-168); unset, it tracks no client IP (its limiter skips, the Nest throttler limits `/api/auth/better/*`) |
| `ANON_DAILY_IP_CAP` / `ANON_DAILY_GLOBAL_CAP` | -- | Free-tier daily caps per IP / in total (defaults 60 / 2000, day in Asia/Jakarta) |
| `OPENROUTER_API_KEY` | Yes* | No chat key is required (chat uses provider records since RX-178, RNX-192). It is the fallback for `EMBEDDING_API_KEY` and for the optional daily price refresh key; `OPENROUTER_APP_TITLE` / `OPENROUTER_APP_URL` are optional. *Required only when `EMBEDDING_API_KEY` is not set |
| `LLM_BASE_URL` / `LLM_API_KEY` | -- | Only `GET /models` for the daily price refresh (RX-21); defaults `https://openrouter.ai/api/v1` / `OPENROUTER_API_KEY`; with no key the refresh is skipped (one log line), not a boot failure (RNX-192). Chat calls go to the model's provider record (RX-178), never here. `HTTP-Referer` and `X-Title` are sent only to OpenRouter's base URL |
| `LLM_DEFAULT_MAX_TOKENS` | -- | `max_tokens` when a caller sets none (default 4096) |
| `EMBEDDING_BASE_URL` / `EMBEDDING_API_KEY` / `EMBEDDING_MODEL` / `EMBEDDING_DIMENSIONS` | -- | Embedding provider (RX-160); defaults OpenRouter's URL, `OPENROUTER_API_KEY`, `intfloat/multilingual-e5-large-instruct`, 1024 (sent as `dimensions`). A vector that is not 1024 long (`knowledge_chunks.embedding vector(1024)`) is refused before anything is written. After changing `EMBEDDING_MODEL` in a local database, clear `knowledge_chunks`; the re-embed job is RX-27 |
| `S3_*` | Yes | S3/MinIO config: `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_CDN_DOMAIN` required; `S3_ENDPOINT` optional (MinIO) |
| `MCP_ENCRYPTION_KEY` | Yes | AES-256-GCM key for stored MCP credentials: exactly 32 bytes, 64 hex or 44 base64 characters (`openssl rand -hex 32`); no fallback, no padding (RX-110) |
| `LLM_KEY_ENCRYPTION_KEY` | Yes | AES-256-GCM key for the provider keys stored through `/admin/providers` (RX-177): exactly 32 bytes, 64 hex or 44 base64 characters (`openssl rand -hex 32`); no fallback. Changing it makes every stored provider key unreadable (enter them again) |
| `LLM_KEY_VERSION` | -- | Version stamped on each sealed provider key (`credential_key_version`), a positive integer; default 1 |
| `MCP_OAUTH_STATE_SECRET` | Yes | HMAC key that signs the state of the MCP OAuth flows (RX-151); no fallback, no flow starts without it. At least 32 characters; generate with `openssl rand -base64 48` |
| `MCP_OAUTH_STATE_TTL_SECONDS` | -- | How long a started MCP OAuth flow stays valid (default 600); its one-time value is in `mcp_oauth_states` |
| `CORS_ORIGIN` | Prod | Comma-separated allowed origins of the product apps; unset, every origin is accepted. Required by the production compose stack |
| `COOKIE_DOMAIN` | Prod | Cross-subdomain cookies (`.renovix.id`) for the Better Auth session and the email-login `jwt` cookie (RX-68); optional, derived from `API_PUBLIC_URL` in production if unset |
| `STRIPE_ENABLED` | -- | Currently `false`, billing uses invitation codes |

API logs (RNX-17, `apps/api/src/common/logger/app-logger.ts`): `NODE_ENV` sets both level and format, no other variable. With `development` every level is logged in Nest's readable format. Any other value logs errors and warnings only, as one JSON object per line. A line written while a request is handled carries `requestId` (the Fastify request id), `route` (the route pattern, not the URL) and `accountId` (or `adminId` on a back-office route) once a guard has accepted the caller. Every line is masked centrally, whatever the call site passes: authorization and cookie headers, API and provider keys, passwords, tokens, Bearer credentials, JWTs and connection-string passwords become `[REDACTED]`, in strings, objects and errors. Every JSON line also carries `severity` (RNX-233: Cloud Logging's field, mapped from `level`: fatal CRITICAL, error ERROR, warn WARNING, log INFO, debug and verbose DEBUG; `level` is kept), and a startup failure is logged through the same logger (`handleFatalStart`, exit code 1), so it is masked and, outside development, one JSON line. No `console.*` call is left in `apps/api/src` outside specs, so none bypasses this logger.

### Production compose stack (`docker-compose.prod.yml`)

The `api` service of `docker-compose.prod.yml` passes every variable below (RNX-165); it sets `NODE_ENV=production` itself. Keep the values in the environment or in an env file outside the repo and name it: `docker compose --env-file /path/outside/the/repo/prod.env -f docker-compose.prod.yml up -d` (`--env-file` also stops compose from reading the repo's own `.env`). The compose file holds no value or default for any secret. Store each secret without a trailing newline (write it with `printf '%s'`, not `echo`): `MCP_ENCRYPTION_KEY` and `LLM_KEY_ENCRYPTION_KEY` must be stored without one, and the API refuses to start otherwise ("MCP_ENCRYPTION_KEY must decode to exactly 32 bytes (64 hex or 44 base64 characters)"); in the other secrets a newline would silently become part of the value.

Required: compose refuses to start (`${NAME:?}`) when one is unset or empty.

| Variable | Format, and how to generate a secret |
|----------|--------------------------------------|
| `JWT_SECRET` | At least 32 characters: `openssl rand -base64 48` |
| `BETTER_AUTH_SECRET` | At least 32 characters: `openssl rand -base64 48` |
| `IP_HASH_SECRET` | At least 32 characters: `openssl rand -base64 48` |
| `MCP_ENCRYPTION_KEY` | 32 bytes as 64 hex characters, or 44 base64 characters ending in `=`: `openssl rand -hex 32` |
| `MCP_OAUTH_STATE_SECRET` | At least 32 characters: `openssl rand -base64 48` |
| `LLM_KEY_ENCRYPTION_KEY` | 32 bytes as 64 hex characters, or 44 base64 characters ending in `=`: `openssl rand -hex 32` |
| `API_KEY_HASH_SECRET` | At least 32 characters: `openssl rand -base64 48`. Changing it makes every stored API key stop working (RNX-18) |
| `ADMIN_JWT_SECRET` | At least 32 characters, and different from `JWT_SECRET`: `openssl rand -base64 48` |
| `ADMIN_TOTP_ENCRYPTION_KEY` | Base64 of 32 bytes: `openssl rand -base64 32` |
| `CORS_ORIGIN` | Comma-separated origins of the product apps (`ADMIN_ORIGIN` is added to the list by the API) |
| `ADMIN_ORIGIN` | The back-office origin, e.g. `https://admin.renovix.id` (no path, no trailing slash) |
| `API_PUBLIC_URL` | The API's public URL, e.g. `https://api.renovix.id` (the code's default is `http://localhost:3000`) |
| `CHAT_APP_URL` | The chat app's URL: MCP OAuth redirects and a trusted auth origin (the code's default is `http://localhost:4201`) |
| `APP_BASE_URL` | The base URL of the links in emails, and a trusted auth origin (the code's defaults are `https://chat.performa.ai` and `http://localhost:3000`) |

Must be set, may be empty (`${S3_CDN_DOMAIN?}`): `S3_CDN_DOMAIN`; empty keeps signed download URLs as they are.

Optional: passed to the container only when set; unset (or empty), the API uses its default.

| Variable | Default when unset |
|----------|--------------------|
| `CLIENT_IP_HEADER` | None: the client IP is the socket address |
| `COOKIE_DOMAIN` | Derived from `API_PUBLIC_URL` (`api.renovix.id` gives `.renovix.id`) |
| `MCP_OAUTH_STATE_TTL_SECONDS` | 600 |
| `LLM_PROVIDER` | `openrouter` (`fake` is refused in production) |
| `LLM_BASE_URL` | `https://openrouter.ai/api/v1` |
| `LLM_API_KEY` | `OPENROUTER_API_KEY`; with neither, the daily price refresh is skipped |
| `LLM_DEFAULT_MAX_TOKENS` | 4096 |
| `LLM_KEY_VERSION` | 1 |
| `EMBEDDING_BASE_URL` | `https://openrouter.ai/api/v1` |
| `EMBEDDING_API_KEY` | `OPENROUTER_API_KEY` |
| `EMBEDDING_MODEL` | `intfloat/multilingual-e5-large-instruct` |
| `EMBEDDING_DIMENSIONS` | 1024 |

The stack also reads, as before, `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB`, the `S3_*` keys above, `OPENROUTER_API_KEY` (needed for embeddings when `EMBEDDING_API_KEY` is not set), `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` and `DASHBOARD_URL`.

`CLIENT_IP_HEADER` is optional for compose, but must be set whenever the API runs behind a proxy. Unset, better-auth's own sign-in limiter is off (RNX-168, D148), and the Nest throttler keys on the socket address, which behind a proxy is the proxy's, so all clients share one bucket.

Besides the configured provider, embedding and S3 endpoints, the API needs outbound HTTPS to `api.frankfurter.dev` (the USD to IDR rate source, RNX-53). If it is blocked, purchases and the public price endpoint answer 503 once the last stored rate is older than 7 days, and at once when no rate has been stored yet (a fresh database).

Frontend apps need `NEXT_PUBLIC_API_URL` (build-time Docker ARG for chat).
