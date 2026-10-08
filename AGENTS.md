# AGENTS.md

## Project

Renovix AI -- unified AI platform (multi-LLM API + chat portal + admin dashboard + landing page). Credit-based billing, RAG knowledge base, AI agents, MCP integrations. Production domain: `renovix.id`.

> The npm scope is `@performa-ai` but the product brand is **Renovix AI**. GCP project: `renovix-ai-prod`.

## Monorepo Layout

Nx 22 monorepo. Package manager: **Bun** (Docker builds fall back to npm with `--legacy-peer-deps`).

| Path | What | Framework | Dev port |
|------|------|-----------|----------|
| `apps/api` | Backend API | NestJS 11 + **Fastify 5** (not Express) | 3000 |
| `apps/chat` | Chat portal | Next.js 16 (App Router) | 4300 |
| `apps/dashboard` | Admin dashboard | Next.js 16 (App Router) | 4200 |
| `apps/landing` | Landing page | Next.js 16 (App Router) | 3001 (prod) |
| `apps/api-e2e` | API E2E tests | Jest + SWC | -- |
| `prisma/` | Schema + 35 migrations + seed | Prisma 7 + pgvector | -- |
| `infra/` | Terraform IaC (7 modules) | GCP, >= Terraform 1.7 | -- |
| `docs/` | 33+ strategy/design docs | Markdown | -- |

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
nx run api:test
nx run api-e2e:test       # Requires running API
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
- **Chat frontend `NEXT_PUBLIC_API_URL`** is a build-time arg baked into the Docker image. In dev it defaults to `http://localhost:3000/api/v1`.

## API Architecture

- 22 NestJS modules in `apps/api/src/app/`
- Request validation: Zod schemas via `nestjs-zod`
- Path alias: `@generated/prisma` -> `./src/generated/prisma`
- OpenAI-compatible endpoint: `POST /api/v1/chat/completions` (API key auth via `ApiKeyGuard`)
- SSE streaming for chat completions and document generation
- Swagger UI at `/api-docs` (served from static `openapi.yaml`, not auto-generated)
- Rate limiting: global 60 req/60s via `ThrottlerGuard`
- AI provider routing: `ProviderRouter` -> adapters (currently only `TogetherAdapter`)
- Prompt tuning: keyword-based intent matching on `PromptTemplate` injects specialized system prompts
- Document generation: detects output format from prompt templates, converts markdown to PDF/DOCX/XLSX, uploads to S3

## Database

- PostgreSQL 16 with pgvector extension (1024-dim embeddings for knowledge base)
- Prisma adapter: `@prisma/adapter-pg` (pg driver-based, not default Prisma engine)
- Schema at `prisma/schema.prisma` (26 models)
- Model naming: PascalCase in schema, snake_case tables via `@@map`
- MCP credentials encrypted with AES-256-GCM (`MCP_ENCRYPTION_KEY` env var)
- Dev DB: `postgres://performa:performa_dev@localhost:5432/performa_ai` (from docker-compose)

## Frontend Patterns

- Dark mode only across all apps
- shadcn/ui components in `src/components/ui/` (new-york style, Radix primitives)
- Tailwind CSS v4 via `@tailwindcss/postcss` plugin
- State: Zustand (persisted to localStorage) + TanStack React Query
- Auth: `better-auth/react` client for SSO, custom JWT for legacy
- Axios interceptors auto-strip responses to `.data` and inject auth headers
- Portal session: UUID stored in localStorage, sent as `X-Portal-Session`

## Infrastructure & Deploy

- **GCP region**: `asia-southeast2` (Jakarta)
- **Terraform state**: GCS bucket `renovix-ai-terraform-state`, prefix `production`
- **Terraform modules**: networking, database (Cloud SQL pgvector), storage (GCS), security (Secret Manager), oauth, cloud-run (4 services), cdn (LB + SSL)
- **Deploy trigger**: push git tag `v<semver>` deploys all apps; `v<semver>-<app>` deploys single app
- **CI** (PRs/push to main): Docker build validation only -- no tests or lint in pipeline
- **Docker builds**: multi-stage, non-root user, `dumb-init` PID 1, build context is always monorepo root
- **Cost toggle scripts**: `bash toggle-on.bash` / `bash toggle-off.bash` to start/stop all GCP services

## Testing

- Jest 30 with SWC transform. No tests run in CI currently.
- API unit tests: `nx run api:test`
- API E2E tests: `nx run api-e2e:test` (requires running API instance)
- Landing tests: Jest + jsdom (`nx run landing:test`)
- Playwright E2E available for landing (`nx run landing:e2e`)

## Environment

Copy `.env.example` to `.env`. Key variables:

| Variable | Required | Notes |
|----------|----------|-------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `JWT_SECRET` | Yes | Legacy auth signing |
| `BETTER_AUTH_SECRET` | Yes | SSO session signing |
| `IP_HASH_SECRET` | Yes | HMAC key for client IPs (free-tier caps); raw IPs are never stored |
| `CLIENT_IP_HEADER` | Prod | Header carrying the client IP (e.g. `x-client-ip`); a trusted proxy in front of the API must set it and overwrite client copies. Unset locally (socket address) |
| `ANON_DAILY_IP_CAP` / `ANON_DAILY_GLOBAL_CAP` | -- | Free-tier daily caps per IP / in total (defaults 60 / 2000, day in Asia/Jakarta) |
| `TOGETHER_API_KEY` | Yes | AI provider (all models) |
| `S3_*` | Yes | S3/MinIO config (bucket, region, keys, endpoint) |
| `MCP_ENCRYPTION_KEY` | For MCP | AES-256 key for OAuth token encryption |
| `CORS_ORIGIN` | Prod | Comma-separated allowed origins |
| `COOKIE_DOMAIN` | Prod | Cross-subdomain cookies (`.renovix.id`) |
| `STRIPE_ENABLED` | -- | Currently `false`, billing uses invitation codes |

Frontend apps need `NEXT_PUBLIC_API_URL` (build-time Docker ARG for chat/dashboard).
