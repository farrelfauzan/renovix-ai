# 🏗️ Build Strategy — Renovix AI

## Overview

A phased execution plan for building Renovix AI — a unified AI API platform with pay-per-use billing. This strategy prioritizes **revenue-generating features first**, keeps infrastructure lean, and avoids premature optimization.

---

## Phase 0: Project Setup (Day 1)

### Goal: Foundational scaffolding

- Initialize monorepo structure:
  ```
  performa-ai/
  ├── apps/
  │   ├── api/          # Backend API (Fastify + TypeScript)
  │   └── dashboard/    # Frontend (Next.js)
  ├── packages/
  │   └── shared/       # Shared types, constants, utils
  ├── docker-compose.yml
  └── .env.example
  ```
- Set up PostgreSQL (local via Docker)
- Set up environment variables management (`.env` + `dotenv`)
- Choose **Node.js + Fastify + TypeScript** — faster iteration, strong async support, good for API-heavy workloads
- Set up Prisma ORM for type-safe database access
- CI: GitHub Actions for lint + test on PR

### Database Schema (Prisma)

```prisma
model User {
  id        String   @id @default(uuid())
  email     String   @unique
  password  String
  balance   Decimal  @default(0) @db.Decimal(12, 6)
  apiKey    String   @unique @default(uuid())
  createdAt DateTime @default(now())
  usageLogs UsageLog[]
  transactions Transaction[]
}

model UsageLog {
  id          String   @id @default(uuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id])
  model       String
  inputTokens Int
  outputTokens Int
  cost        Decimal  @db.Decimal(12, 6)
  latencyMs   Int
  provider    String
  createdAt   DateTime @default(now())
}

model Transaction {
  id        String   @id @default(uuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  amount    Decimal  @db.Decimal(12, 6)
  type      String   // "topup" | "deduction" | "refund"
  status    String   // "pending" | "success" | "failed"
  reference String?  // Stripe/Xendit payment ID
  createdAt DateTime @default(now())
}
```

### Deliverable

- Repo initialized, DB running, schema migrated, health check endpoint live

---

## Phase 1: Core API + Model Routing (Week 1)

### Goal: A working API that routes to LLM providers and returns responses

### Step 1: Auth Middleware

- Generate API keys with prefix: `sk_live_` + crypto random hex
- Auth middleware extracts `Authorization: Bearer sk_live_xxx` → look up user
- Return `401` for invalid/missing keys

### Step 2: Model Registry

- Build a config-driven model registry:
  ```ts
  const models = {
    "llama-3.3-70b": { provider: "together", providerId: "meta-llama/Llama-3.3-70b-Instruct", inputPrice: 0.0000008, outputPrice: 0.0000008 },
    "qwen-2.5-72b": { provider: "together", providerId: "Qwen/Qwen2.5-72B-Instruct", inputPrice: 0.0000009, outputPrice: 0.0000009 },
  };
  ```
- Validate `model` field against registry on every request

### Step 3: Provider Adapters

- Abstract provider calls behind a common interface:
  ```ts
  interface ProviderAdapter {
    chat(params: ChatRequest): Promise<ChatResponse>;
  }
  ```
- Implement `TogetherAdapter` first (primary provider)
- Normalize all responses to a unified format
- Add timeout (30s default) and basic retry (1 retry on 5xx)

### Step 4: Request Pipeline

Implement the full flow from tech doc:

```
Request → Auth → Validate → Estimate Cost → Check Balance → Reserve Credits → Call Provider → Calculate Actual Cost → Adjust Balance → Log Usage → Return Response
```

**Critical:** Use a database transaction for credit reservation + deduction to prevent race conditions.

### Deliverable

- `POST /v1/chat/completions` works end-to-end with real LLM responses
- Can test with `curl` using an API key

---

## Phase 2: Billing System (Week 2)

### Goal: Credits system that never loses money

### Step 1: Balance Management

- All balance operations use **database transactions** (atomic)
- Credit reservation pattern:
  1. Estimate cost from input tokens (use char count / 4 approximation)
  2. `UPDATE users SET balance = balance - estimated WHERE balance >= estimated` (atomic check + deduct)
  3. If rows affected = 0 → insufficient balance → reject
  4. After provider response: calculate actual cost, refund difference
- Store every balance change as a `Transaction` record (audit trail)

### Step 2: Pricing Engine

- Token-based pricing with per-model rates
- Markup strategy: **2x provider cost** (e.g., you pay $0.001, charge $0.002)
- Keep pricing config in the model registry (single source of truth)

### Step 3: Payment Integration

- **Stripe Checkout** for global users (credit card)
- Webhook handler: `checkout.session.completed` → add balance
- Minimum top-up: $5
- **Security:** Verify webhook signatures, idempotent balance updates (use Stripe session ID as `reference`)

### Step 4: Usage Logging

- Log every request asynchronously (don't block the response)
- Store: user, model, provider, input/output tokens, cost, latency, timestamp
- Add a `GET /v1/usage` endpoint for users to query their history

### Deliverable

- Users can top up via Stripe
- Every API call deducts correct cost
- Usage history queryable via API

---

## Phase 3: Dashboard + Auth (Week 3)

### Goal: Self-service UI for developers

### Tech: Next.js + Tailwind CSS + shadcn/ui

### Pages

| Page | Purpose |
|------|---------|
| `/login` | Email + password auth |
| `/register` | Create account |
| `/dashboard` | Balance overview, recent usage chart |
| `/api-keys` | View/copy API key, regenerate |
| `/usage` | Usage table with filters (date, model) |
| `/billing` | Top-up button → Stripe Checkout, transaction history |
| `/docs` | Embedded API documentation |

### Auth Flow

- JWT-based session (httpOnly cookie)
- Registration: email + password (bcrypt hash)
- Keep it simple — no OAuth in MVP

### Dashboard API Endpoints

```
GET  /api/me              → user profile + balance
GET  /api/usage           → usage logs (paginated)
GET  /api/transactions    → payment history
POST /api/keys/regenerate → new API key
POST /api/checkout        → create Stripe checkout session
```

### Deliverable

- Developer can sign up, get API key, top up, see usage — all via UI

---

## Phase 4: Hardening + Launch Prep (Week 3, latter half)

### Goal: Production-ready

### Security

- [ ] Rate limiting: 60 req/min per API key (use `fastify-rate-limit`)
- [ ] Input validation: max 128k tokens per request
- [ ] API key hashing: store hashed keys, compare on auth
- [ ] CORS config for dashboard
- [ ] Helmet headers
- [ ] Request size limit (1MB)

### Reliability

- [ ] Provider fallback: if Together AI fails → try Groq (for supported models)
- [ ] Refund on provider failure (full credit restoration)
- [ ] Health check endpoint: `GET /health`
- [ ] Graceful shutdown handling

### Observability

- [ ] Structured logging (pino)
- [ ] Track: request count, latency p50/p95/p99, error rate, provider uptime
- [ ] Alert on: balance going negative (should never happen), provider error spike

### Deployment

- **API:** Deploy to Railway or Fly.io (simple, fast, auto-TLS)
- **Dashboard:** Deploy to Vercel
- **Database:** Railway PostgreSQL or Supabase
- **Domain:** `api.performa.ai` + `app.performa.ai`

### Deliverable

- Production deployment live, domain configured, SSL active

---

## Launch Checklist

- [ ] API responds correctly to all supported models
- [ ] Stripe payments work (test + live mode)
- [ ] Dashboard: register → top up → copy key → make API call → see usage
- [ ] Rate limiting active
- [ ] Error responses follow consistent format
- [ ] API docs page live
- [ ] No secrets in client-side code
- [ ] Database backups configured
- [ ] Monitoring/alerting active

---

## Post-MVP Roadmap (Prioritized)

| Priority | Feature | Why |
|----------|---------|-----|
| **P0** | More models (Mistral, Claude-compatible) | Expand value prop |
| **P1** | Streaming responses (`stream: true`) | Required for chat UIs |
| **P1** | Xendit integration | Indonesian market |
| **P2** | SDK (JS/Python) | Developer experience |
| **P2** | Smart routing (auto-select cheapest model) | Cost optimization |
| **P3** | RAG-as-a-service | High-value feature |
| **P3** | Self-hosted models | Increase margins |
| **P4** | Enterprise plans (monthly billing, SLA) | Revenue growth |

---

## Key Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Language | TypeScript (Node.js) | Single language for API + dashboard, large ecosystem |
| Framework | Fastify | Faster than Express, built-in validation, good plugin system |
| Database | PostgreSQL | ACID transactions critical for billing, proven at scale |
| ORM | Prisma | Type safety, migrations, good DX |
| Frontend | Next.js | SSR for docs/marketing, React for dashboard |
| Payments | Stripe first | Global reach, excellent API, webhooks |
| Hosting | Railway (API + DB) + Vercel (dashboard) | Low ops overhead, good free tiers, fast deploys |
| AI Provider | Together AI (primary) | Cheap, many models, reliable API |

---

## Risk Mitigation

| Risk | Mitigation | Detection |
|------|-----------|-----------|
| Race condition on balance | Atomic DB transactions with row-level locking | Monitor for negative balances |
| Provider downtime | Fallback provider chain | Health checks, error rate alerts |
| Cost overrun | Always estimate + reserve before calling provider | Track margin per request |
| API key leak | Hash stored keys, allow regeneration | Log key usage patterns |
| Abuse / DDoS | Rate limiting + max token cap | Request volume alerts |

---

## Budget Estimate (MVP)

| Item | Cost/month |
|------|-----------|
| Railway (API + DB) | ~$5-20 |
| Vercel (Dashboard) | Free tier |
| Together AI | Pay-per-use (passed to users with markup) |
| Domain | ~$12/year |
| Stripe fees | 2.9% + $0.30 per transaction |
| **Total fixed** | **~$10-25/month** |

The platform is profitable from the first paying user due to the markup model.
