# Migration: Together AI → OpenRouter

## Summary

Fully migrate from Together AI to OpenRouter as our single LLM provider. OpenRouter provides both OSS models (Qwen, DeepSeek, GPT-OSS, etc.) and premium models (Anthropic Claude, GPT-4o, Gemini Pro) through one unified API, eliminating the need for multiple adapters while unlocking premium model access with per-model cost multipliers and user quota limits.

---

## 1. Problem Statement

| Issue | Impact |
|-------|--------|
| Together AI only offers OSS models (DeepSeek, Qwen, GLM, etc.) | No access to top-tier reasoning models (Claude, GPT-4o, Gemini) |
| Users expect premium model quality for complex tasks | Churn risk, competitive disadvantage |
| Premium models cost 10-50x more per token than OSS models | Flat 2x markup is unsustainable for premium tier |

---

## 2. Product Strategy

### 2.1 Model Tiering

Introduce a **model tier system** visible to users:

| Tier | Models | Credit Multiplier | Target User |
|------|--------|-------------------|-------------|
| **Standard** | DeepSeek V4 Flash, Tencent Hy3, MiMo V2.5, Qwen 3.7 Max | 1x | Free & Starter |
| **Pro** | DeepSeek V4 Pro, Gemini 2.5 Flash, Gemini 3 Flash, Google Gemini 3.5 Flash | 3-5x | Pro plan |
| **Premium** | Claude Sonnet 4.6, xAI Grok 4.3, Gemini 2.5 Pro | 7-12x | Pro/Enterprise |
| **Ultra** | Claude Opus 4.7, Claude Opus 4.8, GPT Chat Latest | 15-25x | Enterprise only |

> **Model selection criteria**: Based on OpenRouter weekly rankings (top 15 by usage), benchmark scores, pricing, and production reliability. Only models with >100B tokens served on OpenRouter are considered for Standard/Pro tiers.

### 2.2 Pricing Model Options

### 2.2 Payment Model (Existing Dual Structure)

We have two separate payment flows:

#### A. Chat Portal — Pay-as-you-go (balance-based)
- Users top up credits via promo codes (Stripe integration planned for later)
- Any model available regardless of tier — user pays per usage
- Cost deducted: `baseCost × model.creditMultiplier × globalMarkup`
- Users see cost estimate before sending
- No subscription required, just sufficient balance
- Example: Claude Sonnet 4.6 at 10x multiplier → ~$0.15 per typical message vs ~$0.002 on DeepSeek V4 Flash

#### B. AI Agents — Tier Subscription
- Users subscribe to a plan that determines agent capabilities
- Subscription controls: which models agents can use, execution limits, context window size
- Plans:

| Plan | Price | Agent Model Access | Agent Executions/mo | Max Context |
|------|-------|-------------------|--------------------:|-------------|
| **Free** | $0 | Standard only | 50 | 32K |
| **Starter** | $9/mo | Standard + Pro | 500 | 128K |
| **Pro** | $29/mo | All tiers | 2,000 | 512K |
| **Enterprise** | $99/mo | All tiers + Fast variants | Unlimited | 1M |

#### How OpenRouter migration affects each:

| Surface | Change |
|---------|--------|
| **Chat Portal** | All models available via OpenRouter. Per-model `creditMultiplier` determines cost. No plan gate — just balance. |
| **AI Agents** | Subscription tier determines which OpenRouter models the agent can use. Higher plans unlock premium/ultra models. |

### 2.3 User Quota & Fair Use

**Chat Portal (pay-as-you-go):**

| Constraint | Free Tier | With Balance |
|------------|-----------|--------------|
| Daily requests | 20 (no balance needed) | Unlimited (deducted from balance) |
| Model access | Standard only (free quota) | All models (pay per use) |
| Rate limit | 5 req/min | 30 req/min |
| Max tokens/request | 4K output | 32K output |

**AI Agents (subscription):**

| Constraint | Free | Starter | Pro | Enterprise |
|------------|------|---------|-----|------------|
| Agent executions/mo | 50 | 500 | 2,000 | Unlimited |
| Model access | Standard only | Standard + Pro | All tiers | All + Fast |
| Max context per run | 32K | 128K | 512K | 1M |
| Concurrent agents | 1 | 3 | 10 | Unlimited |
| Rate limit | 5 req/min | 15 req/min | 30 req/min | 60 req/min |

### 2.4 UX Changes

**Chat Portal:**
1. **Model selector** shows tier badge (Standard/Pro/Premium/Ultra) with price indicator
2. **Cost indicator** per message: "This will use ~0.03 credits" shown before send
3. **Usage dashboard** breakdown by model tier
4. **Low balance warning** when credits drop below threshold

**AI Agents:**
1. **Model selector** grayed out for locked models with "Upgrade to Pro" badge
2. **Execution counter** showing remaining runs this month
3. **Plan upgrade prompt** when hitting tier limits

---

## 3. Technical Strategy

### 3.1 Architecture Change

```
Current:
  ProviderRouter → TogetherAdapter → Together AI API

Target:
  ProviderRouter → OpenRouterAdapter → OpenRouter API (All models: OSS + Premium)
```

Single provider, single adapter. OpenRouter supports all models we need:
- **OSS models**: `qwen/qwen3.5-397b`, `deepseek/deepseek-r1`, `meta-llama/llama-3-8b`
- **Premium models**: `anthropic/claude-sonnet-4`, `openai/gpt-4o`, `google/gemini-2.5-pro`

This simplifies our codebase (one adapter) and gives us access to 200+ models without maintaining multiple provider integrations.

### 3.2 Database Schema Changes

```sql
-- Add to AiModel table
ALTER TABLE ai_models ADD COLUMN tier VARCHAR(20) DEFAULT 'standard';
-- 'standard' | 'pro' | 'premium' | 'ultra'

ALTER TABLE ai_models ADD COLUMN credit_multiplier DECIMAL(6,2) DEFAULT 1.0;
-- Per-model cost multiplier applied on top of base price

ALTER TABLE ai_models ADD COLUMN max_output_tokens INT;
-- Per-model output cap (enforce per tier)

ALTER TABLE ai_models ADD COLUMN plan_required VARCHAR(20) DEFAULT 'free';
-- Minimum plan needed to access: 'free' | 'starter' | 'pro' | 'enterprise'
```

Updated Prisma schema:

```prisma
model AiModel {
  id               String   @id @default(uuid())
  slug             String   @unique
  modelName        String   @map("model_name")
  provider         String   @default("openrouter") // "openrouter" (single provider)
  providerId       String   // OpenRouter model ID (e.g. "anthropic/claude-sonnet-4")
  inputPrice       Decimal  @db.Decimal(18, 12)
  outputPrice      Decimal  @db.Decimal(18, 12)
  maxTokens        Int
  maxOutputTokens  Int?     @map("max_output_tokens")
  tier             String   @default("standard") // standard|pro|premium|ultra
  creditMultiplier Decimal  @default(1.0) @db.Decimal(6, 2) @map("credit_multiplier")
  planRequired     String   @default("free") @map("plan_required")
  active           Boolean  @default(true)
  createdAt        DateTime @default(now()) @db.Timestamptz()
  updatedAt        DateTime @updatedAt @db.Timestamptz()

  @@map("ai_models")
}
```

### 3.3 OpenRouter Adapter (Replaces TogetherAdapter)

Replace `apps/api/src/app/providers/together.adapter.ts` with `openrouter.adapter.ts`:

```typescript
// OpenRouter uses OpenAI-compatible API format (same as Together AI)
// Base URL: https://openrouter.ai/api/v1/chat/completions
// Auth: Bearer <OPENROUTER_API_KEY>
// Extra Headers: X-Title: "Performa AI", HTTP-Referer: "https://performa.ai"
```

Migration from Together is straightforward since both use OpenAI-compatible format:
- Change base URL from `api.together.xyz/v1` → `openrouter.ai/api/v1`
- Add `HTTP-Referer` and `X-Title` headers
- Update model IDs to OpenRouter format: `anthropic/claude-sonnet-4`, `openai/gpt-4o`, `qwen/qwen3.5-397b`
- Streaming, tool use, JSON mode all work identically
- Retry logic and reasoning model support can be preserved as-is

### 3.4 Provider Router Update

```typescript
// provider-router.ts — simplified to single adapter
constructor(
  private readonly openRouterAdapter: OpenRouterAdapter,
) {
  this.adapters = {
    openrouter: this.openRouterAdapter,
  };
}
```

### 3.5 Billing Logic Update

Update `billing.service.ts` to use per-model `creditMultiplier`:

```typescript
// Current: cost = tokens × price × globalMarkup
// New:     cost = tokens × price × model.creditMultiplier × globalMarkup

async reserveBalance(userId: string, model: ModelConfig, estimatedTokens: number) {
  const multiplier = model.creditMultiplier ?? new Decimal(1);
  const estimatedCost = new Decimal(estimatedTokens)
    .mul(model.inputPrice)
    .mul(multiplier)
    .mul(this.markupMultiplier);
  // ... existing atomic reserve logic
}
```

### 3.6 Access Control Gate

Different access logic for each surface:

```typescript
// === Chat Portal (pay-as-you-go) ===
// No plan gate — any model accessible if user has balance
// Free quota (20 req/day) restricted to Standard tier only
async validateChatPortalAccess(userId: string, model: ModelConfig) {
  const user = await this.getUser(userId);

  // Free quota users can only use Standard tier
  if (user.balance <= 0) {
    if (model.tier !== 'standard') {
      throw new ForbiddenException(
        `${model.modelName} requires a positive balance. Top up to use premium models.`
      );
    }
    // Check free daily quota
    await this.portalTierService.checkFreeQuota(userId);
    return;
  }

  // Paid users — just check balance sufficiency (no model restriction)
  const estimatedCost = this.estimateCost(model);
  if (user.balance.lessThan(estimatedCost)) {
    throw new ForbiddenException('Insufficient balance');
  }
}

// === AI Agents (subscription-based) ===
// Plan determines which models the agent can use
async validateAgentAccess(userId: string, model: ModelConfig) {
  const subscription = await this.getSubscription(userId);

  if (!this.canAccessModel(subscription.plan, model.planRequired)) {
    throw new ForbiddenException(
      `${model.modelName} requires ${model.planRequired} plan or above. Current: ${subscription.plan}`
    );
  }

  // Check monthly execution limit
  await this.checkExecutionQuota(userId, subscription);
}
```

### 3.7 Environment Variables

```env
# Remove after migration
# TOGETHER_API_KEY=xxx (deprecated)

# New (replaces Together AI)
OPENROUTER_API_KEY=xxx
OPENROUTER_APP_TITLE=Performa AI
OPENROUTER_APP_URL=https://performa.ai
```

### 3.8 Model Seed Data (OpenRouter)

Pricing sourced from https://openrouter.ai/models (June 2026). Models selected based on:
- Weekly usage rankings (top 15 on OpenRouter)
- Benchmark performance (coding, reasoning, agentic tasks)
- Production reliability (>100B tokens served)

```typescript
const openRouterModels = [
  // ═══════════════════════════════════════════════════
  // STANDARD TIER — Cheap OSS models, high throughput
  // Baseline cost ~$0.10-0.30/M input, $0.20-1.25/M output
  // ═══════════════════════════════════════════════════
  {
    slug: "deepseek-v4-flash",
    modelName: "DeepSeek V4 Flash",
    provider: "openrouter",
    providerId: "deepseek/deepseek-v4-flash",
    inputPrice: new Decimal("0.0000000983"),  // $0.0983/1M tokens
    outputPrice: new Decimal("0.0000001966"), // $0.1966/1M tokens
    maxTokens: 1048576,
    tier: "standard",
    creditMultiplier: 1,
    planRequired: "free",
  },
  {
    slug: "tencent-hy3",
    modelName: "Tencent Hy3",
    provider: "openrouter",
    providerId: "tencent/hy3-preview",
    inputPrice: new Decimal("0.000000063"),   // $0.063/1M tokens
    outputPrice: new Decimal("0.00000021"),   // $0.21/1M tokens
    maxTokens: 262144,
    tier: "standard",
    creditMultiplier: 1,
    planRequired: "free",
  },
  {
    slug: "mimo-v2.5",
    modelName: "Xiaomi MiMo V2.5",
    provider: "openrouter",
    providerId: "xiaomi/mimo-v2.5",
    inputPrice: new Decimal("0.00000014"),    // $0.14/1M tokens
    outputPrice: new Decimal("0.00000028"),   // $0.28/1M tokens
    maxTokens: 1048576,
    tier: "standard",
    creditMultiplier: 1,
    planRequired: "free",
  },
  {
    slug: "deepseek-v3.2",
    modelName: "DeepSeek V3.2",
    provider: "openrouter",
    providerId: "deepseek/deepseek-v3.2",
    inputPrice: new Decimal("0.0000002288"), // $0.2288/1M tokens
    outputPrice: new Decimal("0.0000003432"), // $0.3432/1M tokens
    maxTokens: 131072,
    tier: "standard",
    creditMultiplier: 1,
    planRequired: "free",
  },
  {
    slug: "gemini-2.5-flash-lite",
    modelName: "Gemini 2.5 Flash Lite",
    provider: "openrouter",
    providerId: "google/gemini-2.5-flash-lite",
    inputPrice: new Decimal("0.0000001"),     // $0.10/1M tokens
    outputPrice: new Decimal("0.0000004"),    // $0.40/1M tokens
    maxTokens: 1048576,
    tier: "standard",
    creditMultiplier: 1,
    planRequired: "free",
  },
  {
    slug: "qwen-3.7-max",
    modelName: "Qwen 3.7 Max",
    provider: "openrouter",
    providerId: "qwen/qwen3.7-max",
    inputPrice: new Decimal("0.00000125"),    // $1.25/1M tokens
    outputPrice: new Decimal("0.00000375"),   // $3.75/1M tokens
    maxTokens: 1048576,
    tier: "standard",
    creditMultiplier: 2,
    planRequired: "free",
  },

  // ═══════════════════════════════════════════════════
  // PRO TIER — Mid-range, strong reasoning models
  // Cost ~$0.30-1.50/M input, $2.50-9.00/M output
  // ═══════════════════════════════════════════════════
  {
    slug: "deepseek-v4-pro",
    modelName: "DeepSeek V4 Pro",
    provider: "openrouter",
    providerId: "deepseek/deepseek-v4-pro",
    inputPrice: new Decimal("0.000000435"),   // $0.435/1M tokens
    outputPrice: new Decimal("0.00000087"),   // $0.87/1M tokens
    maxTokens: 1048576,
    tier: "pro",
    creditMultiplier: 3,
    planRequired: "starter",
  },
  {
    slug: "gemini-2.5-flash",
    modelName: "Gemini 2.5 Flash",
    provider: "openrouter",
    providerId: "google/gemini-2.5-flash",
    inputPrice: new Decimal("0.0000003"),     // $0.30/1M tokens
    outputPrice: new Decimal("0.0000025"),    // $2.50/1M tokens
    maxTokens: 1048576,
    tier: "pro",
    creditMultiplier: 3,
    planRequired: "starter",
  },
  {
    slug: "gemini-3-flash",
    modelName: "Gemini 3 Flash Preview",
    provider: "openrouter",
    providerId: "google/gemini-3-flash-preview",
    inputPrice: new Decimal("0.0000005"),     // $0.50/1M tokens
    outputPrice: new Decimal("0.000003"),     // $3.00/1M tokens
    maxTokens: 1048576,
    tier: "pro",
    creditMultiplier: 4,
    planRequired: "starter",
  },
  {
    slug: "gemini-3.5-flash",
    modelName: "Gemini 3.5 Flash",
    provider: "openrouter",
    providerId: "google/gemini-3.5-flash",
    inputPrice: new Decimal("0.0000015"),     // $1.50/1M tokens
    outputPrice: new Decimal("0.000009"),     // $9.00/1M tokens
    maxTokens: 1048576,
    tier: "pro",
    creditMultiplier: 5,
    planRequired: "starter",
  },
  {
    slug: "grok-4.3",
    modelName: "xAI Grok 4.3",
    provider: "openrouter",
    providerId: "x-ai/grok-4.3",
    inputPrice: new Decimal("0.00000125"),    // $1.25/1M tokens
    outputPrice: new Decimal("0.0000025"),    // $2.50/1M tokens
    maxTokens: 1048576,
    tier: "pro",
    creditMultiplier: 5,
    planRequired: "starter",
  },

  // ═══════════════════════════════════════════════════
  // PREMIUM TIER — Frontier models, best quality
  // Cost ~$3-5/M input, $15-30/M output
  // ═══════════════════════════════════════════════════
  {
    slug: "claude-sonnet-4.6",
    modelName: "Claude Sonnet 4.6",
    provider: "openrouter",
    providerId: "anthropic/claude-sonnet-4.6",
    inputPrice: new Decimal("0.000003"),      // $3/1M tokens
    outputPrice: new Decimal("0.000015"),     // $15/1M tokens
    maxTokens: 1048576,
    tier: "premium",
    creditMultiplier: 10,
    planRequired: "pro",
  },
  {
    slug: "gpt-chat-latest",
    modelName: "GPT Chat Latest",
    provider: "openrouter",
    providerId: "openai/gpt-chat-latest",
    inputPrice: new Decimal("0.000005"),      // $5/1M tokens
    outputPrice: new Decimal("0.00003"),      // $30/1M tokens
    maxTokens: 400000,
    tier: "premium",
    creditMultiplier: 12,
    planRequired: "pro",
  },

  // ═══════════════════════════════════════════════════
  // ULTRA TIER — Most powerful, expensive frontier
  // Cost ~$5-10/M input, $25-50/M output
  // ═══════════════════════════════════════════════════
  {
    slug: "claude-opus-4.7",
    modelName: "Claude Opus 4.7",
    provider: "openrouter",
    providerId: "anthropic/claude-opus-4.7",
    inputPrice: new Decimal("0.000005"),      // $5/1M tokens
    outputPrice: new Decimal("0.000025"),     // $25/1M tokens
    maxTokens: 1048576,
    tier: "ultra",
    creditMultiplier: 20,
    planRequired: "enterprise",
  },
  {
    slug: "claude-opus-4.8",
    modelName: "Claude Opus 4.8",
    provider: "openrouter",
    providerId: "anthropic/claude-opus-4.8",
    inputPrice: new Decimal("0.000005"),      // $5/1M tokens
    outputPrice: new Decimal("0.000025"),     // $25/1M tokens
    maxTokens: 1048576,
    tier: "ultra",
    creditMultiplier: 20,
    planRequired: "enterprise",
  },
  {
    slug: "claude-opus-4.8-fast",
    modelName: "Claude Opus 4.8 (Fast)",
    provider: "openrouter",
    providerId: "anthropic/claude-opus-4.8-fast",
    inputPrice: new Decimal("0.00001"),       // $10/1M tokens
    outputPrice: new Decimal("0.00005"),      // $50/1M tokens
    maxTokens: 1048576,
    tier: "ultra",
    creditMultiplier: 25,
    planRequired: "enterprise",
  },
];
```

### 3.9 Model Selection Rationale

| Model | Why Selected | Weekly Tokens (OpenRouter) |
|-------|-------------|---------------------------|
| DeepSeek V4 Flash | #1 most used, cheapest MoE, 1M context, 284B/13B active | 3.28T |
| Tencent Hy3 | #2 most used, ultra-cheap, configurable reasoning | 3.25T |
| Xiaomi MiMo V2.5 | Pro-level agentic at half cost, 1M context | 1.96T |
| DeepSeek V3.2 | Battle-tested, GPT-5 class reasoning, IMO gold | 1.25T |
| Gemini 2.5 Flash Lite | Google's cheapest, good quality, 1M context | 670B |
| Qwen 3.7 Max | Alibaba flagship, strong coding & agentic | 217B |
| DeepSeek V4 Pro | 1.6T params, strongest OSS reasoning | 1.45T |
| Gemini 2.5 Flash | Google workhorse, built-in thinking, top rankings | 658B |
| Gemini 3 Flash | Near-Pro quality at Flash cost, multi-turn | 1.1T |
| Gemini 3.5 Flash | Latest Google, best Flash-tier coding | 605B |
| xAI Grok 4.3 | Strong reasoning, 1M context, no output limit | 96B |
| Claude Sonnet 4.6 | Anthropic best Sonnet, #1 Finance, top coding | 2.19T |
| GPT Chat Latest | OpenAI's latest stable, 400K context | 1.22B |
| Claude Opus 4.7 | Best long-running agents, multi-step tasks | 2.36T |
| Claude Opus 4.8 | Newest Opus, strongest knowledge work | 548B |
| Claude Opus 4.8 Fast | 2x speed Opus for latency-sensitive enterprise | 22.4B |

---

## 4. Migration Plan

### Phase 1: Infrastructure (Week 1-2)
- [ ] Create `OpenRouterAdapter` implementing `ProviderAdapter` interface (port from TogetherAdapter)
- [ ] Add `tier`, `creditMultiplier`, `planRequired`, `maxOutputTokens` to `AiModel` schema
- [ ] Run migration, update all existing models: `provider` → `"openrouter"`, `providerId` → OpenRouter format
- [ ] Backfill existing models with `tier=standard`, `creditMultiplier=1`
- [ ] Remove `TogetherAdapter`, simplify `ProviderRouter` to single adapter
- [ ] Update `ModelRegistryService` to expose tier/multiplier info
- [ ] Add `OPENROUTER_API_KEY` to environment/secrets, remove `TOGETHER_API_KEY`

### Phase 2: Billing & Access Control (Week 2-3)
- [ ] Update `billing.service.ts` to use per-model `creditMultiplier`
- [ ] Add plan-based model access gate
- [ ] Update cost estimation in portal controller
- [ ] Add per-tier rate limiting (extend existing throttle)
- [ ] Update usage logging to include tier and multiplier

### Phase 3: Frontend & UX (Week 3-4)
- [ ] Update model selector UI with tier badges
- [ ] Add cost-per-message indicator
- [ ] Add upgrade prompt for locked models
- [ ] Update usage/billing dashboard with tier breakdown
- [ ] Add low-balance warning for premium model usage

### Phase 4: Seed & Launch (Week 4)
- [ ] Seed OpenRouter models (start with 4-6 premium models)
- [ ] Internal testing with premium models
- [ ] Gradual rollout: Pro users first, then Starter
- [ ] Monitor costs, adjust multipliers based on actual usage patterns

---

## 5. Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| OpenRouter downtime | Implement retry with exponential backoff; consider emergency fallback provider (e.g. direct Anthropic key) for critical models |
| Users burn credits fast on premium | Show real-time cost before send; daily spending cap per user; alert at 80% budget |
| OpenRouter pricing changes | Cache prices, alert on >10% deviation; store our own prices (don't auto-sync) |
| Abuse via API key | Per-model rate limits; anomaly detection on usage spikes |
| Latency increase via OpenRouter proxy | Monitor P95 latency; consider direct provider keys for high-volume enterprise clients later |
| Migration breaking change | Run both adapters in parallel during transition week; feature flag to switch traffic gradually |

---

## 6. Cost Analysis

### Current State (Together AI only)
- Average cost per user/day: ~$0.02-0.05 (OSS models)
- Markup: 2x → revenue per user/day: ~$0.04-0.10

### Projected State (With Premium Models)
- Premium model cost per request: ~$0.01-0.05 (10-50x more)
- With 10x multiplier: User pays $0.10-0.50 per premium request
- Break-even at ~20% premium model usage with 10x multiplier
- **Target margin on premium: 30-50%** (multiplier set accordingly)

### Multiplier Calculation Formula
```
creditMultiplier = (providerCostPerToken / cheapestModelCostPerToken) × targetMarginFactor

Example:
  Claude Sonnet input: $3/1M vs Qwen input: $0.06/1M
  Raw ratio: 50x
  With 20% margin buffer: creditMultiplier = 10 (still profitable)
```

---

## 7. Future Considerations

- **Model auto-routing**: Let AI pick optimal model based on task complexity (save user money)
- **Caching layer**: Cache identical prompts to reduce redundant API calls
- **Direct provider keys**: For high-volume enterprise clients, bypass OpenRouter for lower cost (add Anthropic/OpenAI adapters)
- **Usage analytics**: Track which premium models deliver best satisfaction → recommend
- **OpenRouter provider routing**: Use OpenRouter's `route` parameter to optimize for cost vs speed

---

## 8. GCP Deployment Migration

### 8.1 Current GCP Architecture

```
Region: asia-southeast2 (Jakarta)
Project: renovix-ai-prod

Internet → Global Load Balancer (SSL)
  ├→ api.renovix.id     → Cloud Run: renovix-api (1 CPU, 1Gi, 0-10 instances)
  ├→ chat.renovix.id    → Cloud Run: renovix-chat (1 CPU, 512Mi, 0-5)
  ├→ dashboard.renovix.id → Cloud Run: renovix-dashboard (1 CPU, 512Mi, 0-5)
  ├→ renovix.id         → Cloud Run: renovix-landing (1 CPU, 256Mi, 0-3)
  └→ cdn.renovix.id     → GCS Bucket + Cloud CDN

Cloud Run → VPC Connector → Cloud SQL (PostgreSQL 16, pgvector, private IP)
Secrets → GCP Secret Manager
CI/CD → Cloud Build (parallel build + deploy)
Storage → GCS (ASIA multi-region, S3-compatible HMAC)
```

### 8.2 What Changes for OpenRouter Migration

The GCP infrastructure change is minimal — only secrets and env vars:

| Component | Change Required | Action |
|-----------|----------------|--------|
| Cloud Run (API) | Environment variable swap | Replace `TOGETHER_API_KEY` with `OPENROUTER_API_KEY` + headers |
| Secret Manager | Add new secret, deprecate old | Create `openrouter-api-key`, remove `together-api-key` |
| Cloud Build | No change | Same pipeline deploys updated code |
| Cloud SQL | Schema migration | Add columns to `ai_models` table |
| Load Balancer | No change | Same routing |
| VPC/Networking | No change | OpenRouter is external API (not VPC-routed) |

### 8.3 Secret Manager Changes

```bash
# Step 1: Create new OpenRouter secret
echo -n "sk-or-v1-xxxxx" | gcloud secrets create openrouter-api-key \
  --project=renovix-ai-prod \
  --replication-policy=user-managed \
  --locations=asia-southeast2 \
  --data-file=-

# Step 2: Grant access to API service account
gcloud secrets add-iam-policy-binding openrouter-api-key \
  --project=renovix-ai-prod \
  --member="serviceAccount:renovix-api-sa@renovix-ai-prod.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

# Step 3: After migration verified, remove old secret
gcloud secrets delete together-api-key --project=renovix-ai-prod
```

### 8.4 Cloud Run Environment Update

Update the `renovix-api` service to inject the new secret:

**Terraform change** (infra/modules/cloud-run/main.tf):

```hcl
# Remove:
# env {
#   name = "TOGETHER_API_KEY"
#   value_source {
#     secret_key_ref {
#       secret  = "together-api-key"
#       version = "latest"
#     }
#   }
# }

# Add:
env {
  name = "OPENROUTER_API_KEY"
  value_source {
    secret_key_ref {
      secret  = "openrouter-api-key"
      version = "latest"
    }
  }
}

env {
  name  = "OPENROUTER_APP_TITLE"
  value = "Performa AI"
}

env {
  name  = "OPENROUTER_APP_URL"
  value = "https://chat.renovix.id"
}
```

### 8.5 Database Migration (Cloud SQL)

Run via Cloud Build or direct connection through Cloud SQL Auth Proxy:

```bash
# Connect to Cloud SQL for migration
cloud-sql-proxy renovix-ai-prod:asia-southeast2:renovix-db-asia-southeast2 &

# Run Prisma migration
DATABASE_URL="postgresql://renovix_app:${DB_PASS}@localhost:5432/renovix_ai" \
  npx prisma migrate deploy
```

Migration SQL (generated by Prisma):

```sql
-- Migration: add_model_tiers_and_multipliers
ALTER TABLE ai_models ADD COLUMN tier VARCHAR(20) NOT NULL DEFAULT 'standard';
ALTER TABLE ai_models ADD COLUMN credit_multiplier DECIMAL(6,2) NOT NULL DEFAULT 1.0;
ALTER TABLE ai_models ADD COLUMN max_output_tokens INTEGER;
ALTER TABLE ai_models ADD COLUMN plan_required VARCHAR(20) NOT NULL DEFAULT 'free';

-- Update existing models to openrouter provider
UPDATE ai_models SET provider = 'openrouter';

-- Update provider IDs to OpenRouter format
UPDATE ai_models SET provider_id = 'deepseek/deepseek-v4-flash' WHERE slug = 'deepseek-v4-flash';
-- ... (repeat for each model)

-- Create index for tier-based queries
CREATE INDEX idx_ai_models_tier ON ai_models(tier);
CREATE INDEX idx_ai_models_active_tier ON ai_models(active, tier);
```

### 8.6 Cloud Build Pipeline (No Changes Needed)

The existing `cloudbuild.yaml` pipeline works as-is:
1. Build Docker images (parallel) → includes new `openrouter.adapter.ts`
2. Push to Artifact Registry
3. Deploy to Cloud Run (picks up new env vars from terraform)

Only trigger: push to `main` branch deploys automatically.

### 8.7 Rollback Strategy

If OpenRouter has issues post-migration:

```bash
# Option A: Quick revert — re-deploy previous image
gcloud run services update renovix-api \
  --project=renovix-ai-prod \
  --region=asia-southeast2 \
  --image=asia-southeast2-docker.pkg.dev/renovix-ai-prod/renovix/api:${PREVIOUS_SHA}

# Option B: Feature flag (recommended during transition)
# Keep both adapters for 1 week, toggle via AppConfig
# AppConfig: "active_provider" = "openrouter" | "together"
```

### 8.8 Deployment Checklist

```
Pre-deployment:
  [ ] Create openrouter-api-key in Secret Manager
  [ ] Verify secret accessible by renovix-api-sa
  [ ] Test OpenRouter API key works (curl health check)
  [ ] Run Prisma migration on Cloud SQL
  [ ] Seed new OpenRouter models into ai_models table

Deployment:
  [ ] terraform apply (adds new env vars to Cloud Run)
  [ ] Push code to main → Cloud Build deploys automatically
  [ ] Verify API health: curl https://api.renovix.id/health
  [ ] Test chat with Standard model (DeepSeek V4 Flash)
  [ ] Test chat with Premium model (Claude Sonnet 4.6)
  [ ] Monitor Cloud Run logs for errors: gcloud beta run services logs tail renovix-api

Post-deployment:
  [ ] Monitor P95 latency (should be <3s for standard, <8s for premium)
  [ ] Check billing dashboard — costs within expected range
  [ ] Remove together-api-key from Secret Manager (after 7 days stable)
  [ ] Update terraform.tfvars to remove Together references
  [ ] Remove TogetherAdapter code from codebase
```

### 8.9 Monitoring & Alerting

Add alerts for OpenRouter-specific failure modes:

```yaml
# Cloud Monitoring alert policies
alerts:
  - name: "OpenRouter API errors >5%"
    condition: >
      Cloud Run request count where status=5xx / total > 0.05
      over 5-minute window
    notification: Slack #ops-alerts

  - name: "OpenRouter latency P95 >10s"
    condition: >
      Cloud Run request latency P95 > 10000ms
      over 5-minute window
    notification: Slack #ops-alerts

  - name: "OpenRouter 429 rate limit"
    condition: >
      Log entries matching "status=429" > 10 in 1 minute
    notification: Slack #ops-alerts, PagerDuty

  - name: "Monthly OpenRouter spend >$500"
    condition: >
      Sum of usage_logs.cost over current month > 500
    notification: Email founders
```
