# Renovix AI

A unified AI platform that provides access to multiple LLM models through a single API and chat portal, with pay-as-you-go credit-based billing.

> One API for all AI models — cheaper, with pay-as-you-go pricing.

## Overview

Renovix AI solves the complexity of working with multiple AI providers by offering:

- **Unified API** — Single endpoint compatible with OpenAI's format, routing to models like LLaMA, Qwen, and more via OpenRouter
- **Chat Portal** — Web-based chat interface with free tier (20 requests/day) and paid tier with model selection
- **Per-User Knowledge Base** — Upload `.md` files for RAG-powered contextual responses
- **Conversation History** — Persistent chat history for logged-in users
- **Credit System** — Pay-per-token billing with Stripe integration

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **API** | NestJS + Fastify |
| **Database** | PostgreSQL + pgvector |
| **ORM** | Prisma |
| **Chat Frontend** | Next.js 14 + React + Tailwind CSS + shadcn/ui |
| **Back-office** | Next.js + Tailwind CSS |
| **Landing Page** | Next.js + Tailwind CSS |
| **State Management** | Zustand + TanStack React Query |
| **AI Provider** | OpenRouter (chat + embeddings) |
| **Payments** | Stripe |
| **File Storage** | AWS S3 (local development uses the AWS dev bucket) |
| **Monorepo** | Nx |
| **Package Manager** | Bun |

## Project Structure

```
apps/
  api/          # NestJS backend API
  chat/         # Next.js chat portal
  back-office/  # Next.js staff back-office
  landing/      # Next.js landing page
  api-e2e/      # API end-to-end tests
prisma/         # Schema, migrations, seed
docs/           # Documentation
```

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) (v1.0+)
- [Docker](https://www.docker.com/) & Docker Compose
- [Node.js](https://nodejs.org/) (v18+)

### Setup

1. **Clone the repo**
   ```bash
   git clone git@github.com:farrelfauzan/renovix-ai.git
   cd renovix-ai
   ```

2. **Install dependencies**
   ```bash
   bun install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env
   ```
   Fill in the required values (see [Environment Variables](#environment-variables)).

   **S3 for local development:** file storage is the AWS dev bucket; there is no local storage service. Ask the Tech Lead for the dev-only key and the bucket's region, and put them in `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` and `S3_REGION` (the API does not start while `S3_REGION` is empty). Leave `S3_ENDPOINT` out. Never commit these values and never use production keys. Details: [infra/aws-assets/README.md](infra/aws-assets/README.md).

   **Local uploads:** a document upload needs the `S3_*` values and working embedding settings: `EMBEDDING_BASE_URL`; `EMBEDDING_API_KEY`, or `OPENROUTER_API_KEY` as its fallback; and an `EMBEDDING_MODEL` that the provider serves at 1024 dimensions. If the provider does not serve the model, the upload fails with `Model not found at the provider (400)`: set `EMBEDDING_MODEL` to a model that provider has. A profile photo needs only the `S3_*` values.

   If an upload fails with `SignatureDoesNotMatch`, the S3 key pair in `.env` is wrong. `S3_ACCESS_KEY_ID` is 20 characters and `S3_SECRET_ACCESS_KEY` is 40, with no stray spaces or quotes, and `S3_ENDPOINT` is not set. If it still fails, ask the Tech Lead for a new key for the dev user ([infra/aws-assets/README.md](infra/aws-assets/README.md), step 2).

   On a fresh local database a document upload is refused with `Top up required to use knowledge base features` until the account has a package and paid credits. Run `bun run seed`, then `bun run seed:dev-account <email>` for an existing account, with the email in lower case.

4. **Start infrastructure**
   ```bash
   docker compose up -d
   ```
   This starts PostgreSQL (and the two read-only API documentation pages). It starts no file storage.

5. **Run database migrations**
   ```bash
   bun run prisma:migrate
   ```
   The history is one baseline migration (RX-90). A local database created before it must be recreated with `bun run prisma:reset` (drops its data).

6. **Generate Prisma client**
   ```bash
   bun run prisma:generate
   ```

7. **Seed the database**
   ```bash
   bun run prisma:seed
   ```
   The seed writes no providers or models (RX-177). Create them as an admin through `/api/v1/admin/providers` (below); `prisma/seed-agents.ts` then uses the slug you pass (`npx tsx prisma/seed-agents.ts <slug>`) or the cheapest active standard model.

### Development

```bash
# Run all apps in parallel
bun run dev:all

# Or run individually
bun run dev:api        # API on http://localhost:3000
bun run dev:chat       # Chat portal on http://localhost:4201
bun run dev:back-office # Back-office on http://localhost:4400
bun run dev:landing    # Landing page on http://localhost:4202
```

### Build

```bash
# Build all apps
bun run build:all

# Or individually
bun run build:api
bun run build:chat
bun run build:back-office
bun run build:landing
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Secret key for JWT token signing |
| `IP_HASH_SECRET` | Required. HMAC key for client IPs (free-tier caps) |
| `OPENROUTER_API_KEY` | OpenRouter API key for LLM and embeddings |
| `LLM_KEY_ENCRYPTION_KEY` | Required. AES-256-GCM key (32 bytes, 64 hex or 44 base64 characters) for the provider keys stored through `/admin/providers` |
| `LLM_KEY_VERSION` | Version stamped on each stored provider key (default 1) |
| `STRIPE_SECRET_KEY` | Stripe secret key for payments |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `S3_BUCKET` | S3 bucket name for file storage |
| `S3_REGION` | S3 region |
| `S3_ACCESS_KEY_ID` | S3 access key |
| `S3_SECRET_ACCESS_KEY` | S3 secret key |
| `S3_ENDPOINT` | S3 endpoint of another S3-compatible host (not set for AWS S3, also in local dev) |

## API

The API follows the OpenAI-compatible format:

```
POST /api/v1/chat/completions
```

### Portal Endpoints

| Endpoint | Description |
|----------|-------------|
| `POST /api/v1/chat/portal/completions` | Chat completion (SSE streaming) |
| `GET /api/v1/chat/portal/usage` | Get usage and balance info |
| `GET /api/v1/chat/portal/models` | List available models |
| `GET /api/v1/chat/portal/conversations` | List conversation history |
| `GET /api/v1/chat/portal/knowledge` | List knowledge bases |
| `POST /api/v1/chat/portal/knowledge/:id/upload` | Upload `.md` file to knowledge base |

### Back-office provider endpoints (RX-177)

Staff only (back-office session, `providers:*` or `models:*`). The key is write-only: responses show `hasApiKey` and its last 4 characters.

| Endpoint | Description |
|----------|-------------|
| `GET /api/v1/admin/providers` | List live providers with their model count |
| `GET /api/v1/admin/providers/:id` | One provider |
| `POST /api/v1/admin/providers` | Create a provider (inactive): `type` (`9router` or `openai_compatible`), `name`, `baseUrl`, `apiKey` |
| `PATCH /api/v1/admin/providers/:id` | Change name, base URL, key (rotation) or set `status: "inactive"` |
| `POST /api/v1/admin/providers/:id/test` | One minimal request with `{ slug }`; 200 with `isSuccessful` and a reason, whether the test passed or failed. 400 on a bad slug or body, 404 on an unknown provider, 409 when the provider changed during the test (result not stored) or its stored key cannot be decrypted with the current `LLM_KEY_ENCRYPTION_KEY` |
| `POST /api/v1/admin/providers/:id/activate` | Activate after a successful test (409 otherwise) |
| `DELETE /api/v1/admin/providers/:id` | Soft delete (409 while it has active models) |
| `GET /api/v1/admin/providers/:id/models` | The provider's models |
| `POST /api/v1/admin/providers/:id/models` | Create a model: `slug` (the provider's own model id), `modelName`, `tier`, prices, `maxTokens`, `active` |
| `PATCH /api/v1/admin/providers/:id/models/:modelId` | Change a model (not its slug); deactivate with `active: false` |

## License

Private — All rights reserved.
