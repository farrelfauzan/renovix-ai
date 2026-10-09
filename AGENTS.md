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
- **Body limit differs by env** -- dev: 50MB, production: 1MB (configured in `apps/api/src/main.ts`).
- **TypeScript build errors are ignored** in all Next.js apps (`ignoreBuildErrors: true` in next.config). The build will succeed even with TS errors.
- **No ESLint or Prettier** is configured. No lint step exists.
- **Two webpack configs for API** -- `webpack.config.js` (Nx dev serve) and `webpack.docker.config.js` (Docker production build with ts-loader).
- **`NEXT_PUBLIC_API_URL`** is a build-time arg baked into the chat and dashboard Docker images (default `https://api.renovix.id`). Without it the chat app falls back to `http://localhost:3000/api/v1`.

## API Architecture

- 21 feature modules (`*.module.ts`) in `apps/api/src/app/`, plus the root `AppModule`; `AppModule` imports 20 of them, `MemoryModule` is imported by `ChatModule` and `PortalModule`
- Request validation: Zod schemas parsed manually with `safeParse` in the controllers (`nestjs-zod` is in package.json but unused)
- Path alias: `@generated/prisma` -> `./src/generated/prisma`
- OpenAI-compatible endpoint: `POST /api/v1/chat/completions` (API key auth via `ApiKeyGuard`)
- SSE streaming for chat completions and document generation
- Swagger UI at `/api-docs` (served from static `openapi.yaml`, not auto-generated)
- Rate limiting: global 60 req/60s via `ThrottlerGuard`
- AI provider routing: `ProviderRouter` -> adapters (currently only `OpenRouterAdapter`, provider key `openrouter`; chat models and embeddings go through OpenRouter)
- Prompt tuning: keyword-based intent matching on `PromptTemplate` injects specialized system prompts
- Document generation: detects output format from prompt templates, converts markdown to PDF/DOCX/XLSX, uploads to S3

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

| Variable | Required | Notes |
|----------|----------|-------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `JWT_SECRET` | Yes | Legacy auth signing |
| `BETTER_AUTH_SECRET` | Yes | SSO session signing (code falls back to `JWT_SECRET`, then a placeholder, if unset) |
| `IP_HASH_SECRET` | Yes | HMAC key for client IPs (free-tier caps); raw IPs are never stored |
| `CLIENT_IP_HEADER` | Prod | Header carrying the client IP (e.g. `x-client-ip`); a trusted proxy in front of the API must set it and overwrite client copies. Unset locally (socket address) |
| `ANON_DAILY_IP_CAP` / `ANON_DAILY_GLOBAL_CAP` | -- | Free-tier daily caps per IP / in total (defaults 60 / 2000, day in Asia/Jakarta) |
| `OPENROUTER_API_KEY` | Yes | AI provider (chat models and embeddings); `OPENROUTER_APP_TITLE` / `OPENROUTER_APP_URL` are optional |
| `S3_*` | Yes | S3/MinIO config: `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_CDN_DOMAIN` required; `S3_ENDPOINT` optional (MinIO) |
| `MCP_ENCRYPTION_KEY` | For MCP | AES-256 key for OAuth token encryption; if unset the code uses a hard-coded dev key, so always set it outside local dev |
| `CORS_ORIGIN` | Prod | Comma-separated allowed origins (not in `.env.example`) |
| `COOKIE_DOMAIN` | Prod | Cross-subdomain cookies (`.renovix.id`) for the Better Auth session and the email-login `jwt` cookie (RX-68); optional, derived from `API_PUBLIC_URL` in production if unset |
| `STRIPE_ENABLED` | -- | Currently `false`, billing uses invitation codes |

Frontend apps need `NEXT_PUBLIC_API_URL` (build-time Docker ARG for chat/dashboard).
