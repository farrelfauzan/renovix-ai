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
| **Dashboard** | Next.js |
| **Landing Page** | Next.js + Tailwind CSS |
| **State Management** | Zustand + TanStack React Query |
| **AI Provider** | OpenRouter (chat + embeddings) |
| **Payments** | Stripe |
| **File Storage** | AWS S3 (MinIO for local dev) |
| **Monorepo** | Nx |
| **Package Manager** | Bun |

## Project Structure

```
apps/
  api/          # NestJS backend API
  chat/         # Next.js chat portal
  dashboard/    # Next.js admin dashboard
  landing/      # Next.js landing page
  api-e2e/      # API end-to-end tests
  dashboard-e2e/# Dashboard e2e tests
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

4. **Start infrastructure**
   ```bash
   docker compose up -d
   ```

5. **Run database migrations**
   ```bash
   bun run prisma:migrate
   ```

6. **Generate Prisma client**
   ```bash
   bun run prisma:generate
   ```

7. **Seed the database**
   ```bash
   bun run prisma:seed
   ```

### Development

```bash
# Run all apps in parallel
bun run dev:all

# Or run individually
bun run dev:api        # API on http://localhost:3000
bun run dev:chat       # Chat portal on http://localhost:4201
bun run dev:dashboard  # Dashboard on http://localhost:4200
bun run dev:landing    # Landing page on http://localhost:4202
```

### Build

```bash
# Build all apps
bun run build:all

# Or individually
bun run build:api
bun run build:chat
bun run build:dashboard
bun run build:landing
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Secret key for JWT token signing |
| `IP_HASH_SECRET` | Required. HMAC key for client IPs (free-tier caps) |
| `OPENROUTER_API_KEY` | OpenRouter API key for LLM and embeddings |
| `STRIPE_SECRET_KEY` | Stripe secret key for payments |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `S3_BUCKET` | S3 bucket name for file storage |
| `S3_REGION` | S3 region |
| `S3_ACCESS_KEY_ID` | S3 access key |
| `S3_SECRET_ACCESS_KEY` | S3 secret key |
| `S3_ENDPOINT` | S3 endpoint (use MinIO URL for local dev) |

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

## License

Private — All rights reserved.
