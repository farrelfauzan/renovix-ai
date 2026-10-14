# AGENTS.md

## Project

Renovix AI -- unified AI platform (multi-LLM API + chat portal + admin dashboard + landing page). Credit-based billing, RAG knowledge base, AI agents, MCP integrations. Production domain: `renovix.id`.

> The npm scope is `@performa-ai` but the product brand is **Renovix AI**. Repo: GitHub `farrelfauzan/renovix-ai`. Plan, tickets and decisions: [Renovix AI project in Notion](https://app.notion.com/p/3f352ed08ee2811daafefab59f5512bb). Product direction for billing: `docs/billing-direction.md`.

## Monorepo Layout

Nx 22 monorepo. Package manager: **Bun** (Docker builds fall back to npm with `--legacy-peer-deps`).

| Path | What | Framework | Dev port |
|------|------|-----------|----------|
| `apps/api` | Backend API | NestJS 11 + **Fastify 5** (not Express) | 3000 |
| `apps/chat` | Chat portal | Next.js 16 (App Router) | 4300 |
| `apps/dashboard` | Admin dashboard (a stub so far: placeholder page + auth client) | Next.js 16 (App Router) | 4200 (Docker, `DASHBOARD_URL`); `nx dev` does not pin a port |
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
bun run dev:dashboard    # Dashboard on localhost:4200
bun run dev:landing      # Landing page
bun run dev:all          # All apps in parallel

# Build
bun run build:api
bun run build:chat
bun run build:dashboard
bun run build:landing

# Prisma (MUST run generate before building API)
bun run prisma:generate  # Outputs to apps/api/src/generated/prisma (gitignored)
bun run prisma:migrate   # Dev migrations
bun run prisma:reset     # Reset + re-seed
bun run prisma:seed      # Seed models, configs, prompts, plans, codes
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
- **`NEXT_PUBLIC_API_URL`** is a build-time arg baked into the chat and dashboard Docker images (default `https://api.renovix.id`). Without it the chat app falls back to `http://localhost:3000/api/v1`.

## API Architecture

- 21 modules (`*.module.ts`) in `apps/api/src/app/`, plus the root `AppModule`; `AppModule` imports 20 of them, `MemoryModule` is imported by `ChatModule` and `PortalModule`
- Request validation: Zod schemas parsed manually with `safeParse` in the controllers (`nestjs-zod` is in package.json but unused)
- Path alias: `@generated/prisma` -> `./src/generated/prisma`
- OpenAI-compatible endpoint: `POST /api/v1/chat/completions` (API key auth via `ApiKeyGuard`)
- SSE streaming for chat completions and document generation
- Swagger UI at `/api-docs` (served from static `openapi.yaml`, not auto-generated)
- Rate limiting: global 60 req/60s via `ThrottlerGuard`
- AI provider routing: `ProviderRouter` -> adapters (currently only `OpenRouterAdapter`, provider key `openrouter`; chat models and embeddings go through OpenRouter)
- Prompt tuning: keyword-based intent matching on `PromptTemplate` injects specialized system prompts
- Document generation: detects output format from prompt templates, converts markdown to PDF/DOCX/XLSX, uploads to S3

### API module layout

- A feature module is every folder of `apps/api/src/app/` except `prisma`, `config`, `providers` and `google-storage` (18 today).
- Code shared by the modules lives in `apps/api/src/common/`, in a folder named for its kind (today: `guards/`, `decorators/`, `types/`, `utils/`; `access.module.ts` at its root). A folder is created when its first file arrives.
- Inside a feature module, files are arranged by layer: `controller/`, `service/`, `repository/` (today: codes), `dto/`. A file of another kind goes into a folder named for its kind (today: `guard/`, `scheduler/`, `strategy/`, `converter/`, `config/`, `utils/` for helpers, `types/`).
- Only the `<module>.module.ts` file stays at the module root.
- A test file sits in the folder of the file it tests; a test that covers several files sits next to its main subject (HTTP tests in `controller/`).
- `bun run check` enforces it (step "module layout", `scripts/check-module-layout.ts`): it fails and names any source file that lies directly in a feature module folder.
- Code rules: `.claude/rules/nestjs-clean-typescript.md` and `.claude/rules/nextjs-frontend.md` (tracked in git).

### Helpers

- A helper is a function that passes three tests: (1) it uses nothing injected (never uses `this`); (2) plain values in, plain values out: no database, network or file, nothing like a client or transaction passed in, no `await`, no clock, randomness or environment; (3) it is not an entry point (route handler, guard `canActivate`, sign-in strategy `validate`, interceptor, lifecycle hook, scheduled job).
- A helper does not stay in a service, controller, guard or scheduler class. It goes into the `utils/` folder of its module, one function per file, the file named for the function in kebab-case (`billing/utils/estimate-cost.ts` exports `estimateCost`), with its test beside it.
- The module that owns a helper keeps it, and other modules import it from there (chat and portal import the billing helpers from `billing/utils/`). Identical copies with no owner go to `apps/api/src/common/utils`.
- `bun run check` enforces test 1 (step "helper rule", `scripts/check-helper-rule.ts`): it fails and names any class method in those files that never uses `this`, unless `scripts/helper-rule-exceptions.ts` lists it with its reason (it fails test 2 or 3, or a named ticket will move it). A list entry that matches no such method any more fails too, so the list can only shrink.

### Repositories

- New code reaches the database only through a repository: `<module>/repository/<name>.repository.ts`, an injectable class that takes `PrismaService`. Only repositories and the Prisma module (`apps/api/src/app/prisma/`) import `PrismaService` or the generated Prisma client; `import type` from the generated client is allowed everywhere. Controllers, guards and schedulers use services, never repositories.
- A repository holds queries only. Its methods are named for the operation (`findRedemption(codeId, userId)`), take the user or workspace as a required argument and return Prisma's generated types. A service never builds a query condition; who may do what stays in the service. Raw SQL lives only in repositories.
- Every repository method takes the transaction (`DbTransaction`) as its last argument: optional, and required on a method that changes a balance or writes a ledger or redemption row. A service runs several repository calls in one transaction with `TransactionService.run(work, options?, tx?)`; given `tx` it joins that transaction. Both come from the Prisma module. Never keep a transaction open across a model call or a stream.
- `PrismaService` carries the default filter for soft-deleted rows (no model on it yet). It covers top-level reads only: a relation in `include` or `select`, `_count`, a relation filter, raw SQL and every write need the condition written in the repository.
- `bun run check` enforces the import rule (step "prisma imports", `scripts/check-prisma-imports.ts`). `scripts/prisma-import-exceptions.ts` lists the files not moved yet; it may only shrink, never add a file to it.
- In tests `createTestModule` provides the repositories; add a new one to the list in `apps/api/test/test-module.ts`. Pilot: `apps/api/src/app/codes/`. Rules, decisions and measurements: `docs/repository-layer.md`.

## Database

- PostgreSQL 16 with pgvector extension (1024-dim embeddings for knowledge base)
- Prisma adapter: `@prisma/adapter-pg` (pg driver-based, not default Prisma engine)
- Schema at `prisma/schema.prisma` (41 models)
- Model naming: PascalCase in schema, snake_case tables via `@@map`
- MCP credentials encrypted with AES-256-GCM (`MCP_ENCRYPTION_KEY` env var)
- Dev DB: `postgres://performa:performa_dev@localhost:5432/performa_ai` (from docker-compose)

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

Copy `.env.example` to `.env`. Key variables:

`JWT_SECRET`, `BETTER_AUTH_SECRET`, `IP_HASH_SECRET` and `MCP_ENCRYPTION_KEY` are required in every mode (RX-110, `apps/api/src/common/utils/assert-required-secrets.ts`). With `NODE_ENV` development or test the dev-only values of `.env.example` are accepted; any other `NODE_ENV`, unset included, is production: the API refuses to start on a missing, placeholder or shorter-than-32-character value, or an `MCP_ENCRYPTION_KEY` that is not 32 bytes.

| Variable | Required | Notes |
|----------|----------|-------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `JWT_SECRET` | Yes | Legacy auth signing |
| `BETTER_AUTH_SECRET` | Yes | SSO session signing; no fallback (RX-110) |
| `ADMIN_JWT_SECRET` | Yes | Signs the back-office access token (RX-94); no fallback, the API does not start without it. At least 32 characters and never the same as `JWT_SECRET`; generate with `openssl rand -base64 48` |
| `ADMIN_TOTP_ENCRYPTION_KEY` | Yes | AES-256-GCM key for the back-office admins' TOTP secrets at rest (RX-94); no fallback. 32 bytes, base64; generate with `openssl rand -base64 32` |
| `ADMIN_ORIGIN` | Yes | The back-office app's own origin (RX-156), e.g. `https://admin.renovix.id`; locally `http://localhost:4400`. Every `/admin` route answers 403 to any other `Origin` (the product apps' included) and to a POST/PUT/PATCH/DELETE without `Origin`. Exactly one origin (no path, no trailing slash); no fallback, the API does not start without it. Separate from `CORS_ORIGIN` |
| `IP_HASH_SECRET` | Yes | HMAC key for client IPs (free-tier caps); raw IPs are never stored |
| `CLIENT_IP_HEADER` | Prod | Header carrying the client IP (e.g. `x-client-ip`); a trusted proxy in front of the API must set it and overwrite client copies. Unset locally (socket address) |
| `ANON_DAILY_IP_CAP` / `ANON_DAILY_GLOBAL_CAP` | -- | Free-tier daily caps per IP / in total (defaults 60 / 2000, day in Asia/Jakarta) |
| `OPENROUTER_API_KEY` | Yes | AI provider (chat models and embeddings); `OPENROUTER_APP_TITLE` / `OPENROUTER_APP_URL` are optional |
| `S3_*` | Yes | S3/MinIO config: `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_CDN_DOMAIN` required; `S3_ENDPOINT` optional (MinIO) |
| `MCP_ENCRYPTION_KEY` | Yes | AES-256-GCM key for stored MCP credentials: exactly 32 bytes, 64 hex or 44 base64 characters (`openssl rand -hex 32`); no fallback, no padding (RX-110) |
| `CORS_ORIGIN` | Prod | Comma-separated allowed origins (not in `.env.example`) |
| `COOKIE_DOMAIN` | Prod | Cross-subdomain cookies (`.renovix.id`) for the Better Auth session and the email-login `jwt` cookie (RX-68); optional, derived from `API_PUBLIC_URL` in production if unset |
| `STRIPE_ENABLED` | -- | Currently `false`, billing uses invitation codes |

Frontend apps need `NEXT_PUBLIC_API_URL` (build-time Docker ARG for chat/dashboard).
