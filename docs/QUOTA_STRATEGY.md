# Quota & Rate Limiting Strategy

> Applies to: Chat Portal (pay-as-you-go) + AI Agents (subscription)
> Related: [OPENROUTER_MIGRATION_STRATEGY.md](./archive/OPENROUTER_MIGRATION_STRATEGY.md), [OPENROUTER_PRICING_ANALYSIS.md](./OPENROUTER_PRICING_ANALYSIS.md)

---

## 1. Current State

### Existing Implementation
- **Free tier**: 20 requests/day, cheapest model only, resets at midnight UTC
- **Paid tier**: Unlimited requests, deducted from balance
- **Global rate limit**: 60 req/min (ThrottlerModule)
- **Portal endpoint**: 30 req/min (`@Throttle`)
- **IP abuse prevention**: Max 3 new sessions per IP per 24h
- **Session cleanup**: Weekly cron removes sessions inactive 30+ days
- **Daily reset**: Cron at `0 0 * * *` (midnight UTC) resets free tier counts

### What Needs to Change
- Add **per-model-tier** quota enforcement
- Add **agent execution quota** tracking (monthly)
- Add **token budget** limits per tier
- Add **soft/hard limits** with grace periods
- Add **spending caps** for premium model usage

---

## 2. Quota Architecture

### 2.1 Two Surfaces, Two Quota Systems

```
┌─────────────────────────────────────────────────────────┐
│                   CHAT PORTAL                            │
│  Quota based on: balance + daily free request limit     │
│  Model gate: balance > 0 → all models                  │
│              balance = 0 → Standard tier only (20/day)  │
│  Rate limit: per-user, per-tier                         │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                   AI AGENTS                              │
│  Quota based on: subscription plan                      │
│  Model gate: plan determines tier access                │
│  Execution limit: monthly, per-plan                     │
│  Token budget: monthly, per-plan                        │
└─────────────────────────────────────────────────────────┘
```

### 2.2 Quota Dimensions

| Dimension | Chat Portal | AI Agents |
|-----------|-------------|-----------|
| **Request count** | Daily (free) / Unlimited (paid) | Monthly execution cap |
| **Token budget** | No cap (balance-deducted) | Monthly token cap per plan |
| **Model access** | Balance-gated | Plan-gated |
| **Rate limit** | Per-minute, per-tier | Per-minute, per-plan |
| **Spending cap** | Optional daily cap (user-set) | Included in plan |
| **Concurrency** | N/A | Max concurrent agent runs |

---

## 3. Chat Portal Quotas

### 3.1 Free Tier (No Balance)

| Constraint | Limit | Enforcement |
|------------|-------|-------------|
| Daily requests | 20 | Hard limit, resets midnight UTC |
| Model access | Standard tier only | Reject non-standard models |
| Max output tokens | 4,096 | Truncate at limit |
| Max input context | 16K tokens | Reject if over |
| Rate limit | 5 req/min | 429 Too Many Requests |
| Session limit per IP | 3 per 24h | Prevent multi-account abuse |

**When exhausted:**
- Show "You've used all 20 free messages today. Top up or wait until tomorrow."
- Display countdown timer to next reset
- Suggest top-up packages

### 3.2 Paid Tier (Has Balance)

| Constraint | Limit | Enforcement |
|------------|-------|-------------|
| Daily requests | Unlimited | Deducted from balance |
| Model access | All tiers (Standard/Pro/Premium/Ultra) | Balance check before send |
| Max output tokens | 32,768 | Per-model `maxOutputTokens` |
| Max input context | Model-specific (up to 1M) | Per-model `maxTokens` |
| Rate limit | 30 req/min | 429 Too Many Requests |
| Daily spending cap | User-configurable (optional) | Soft warning at 80%, hard stop at 100% |

**Daily spending cap (optional, user-set):**
- User can set "max $X per day" in settings
- Default: no cap (unlimited spend)
- When 80% reached: warning banner in chat
- When 100% reached: block requests, show "Daily budget exhausted"
- Resets at midnight UTC

### 3.3 Balance Insufficient Handling

```
Balance check flow:
1. Estimate cost: (inputTokens × inputPrice + outputTokens × outputPrice) × multiplier × markup
2. If balance < estimatedCost → reject with "Insufficient balance"
3. Reserve estimated cost (atomic debit)
4. Stream response
5. Adjust (refund overage or charge shortfall)
```

**Edge case: balance runs out mid-stream**
- Allow current response to complete (small overage risk ~$0.01-0.05)
- Mark account as "overdrawn" if balance goes negative
- Next request blocked until top-up
- Grace: allow up to -$0.10 overdraft (absorbed as cost of business)

---

## 4. AI Agent Quotas

### 4.1 Plan Limits

| Constraint | Free | Starter ($9) | Pro ($29) | Enterprise ($99) |
|------------|:----:|:------------:|:---------:|:----------------:|
| Monthly executions | 50 | 500 | 2,000 | Unlimited |
| Monthly token budget | 500K | 5M | 25M | 100M |
| Model access | Standard | Standard + Pro | All tiers | All + Fast variants |
| Max context/run | 32K | 128K | 512K | 1M |
| Concurrent agents | 1 | 3 | 10 | Unlimited |
| Max agent tools | 3 | 10 | 25 | Unlimited |
| Rate limit | 5 req/min | 15 req/min | 30 req/min | 60 req/min |
| Knowledge bases | 1 (5MB) | 5 (50MB) | 20 (500MB) | Unlimited |

### 4.2 Execution Quota Tracking

```typescript
// Schema addition
model UserSubscription {
  // ... existing fields
  messagesUsed     Int       @default(0)      // agent executions this period
  tokensUsed       BigInt    @default(0)      // total tokens consumed this period
  currentPeriodStart DateTime @db.Timestamptz()
  currentPeriodEnd   DateTime @db.Timestamptz()
}
```

**Period reset logic:**
- Billing cycle: 30 days from subscription start (not calendar month)
- On renewal: reset `messagesUsed` and `tokensUsed` to 0
- No rollover of unused quota

### 4.3 Overage Handling

| Plan | Overage Policy |
|------|----------------|
| Free | Hard stop. Must upgrade. |
| Starter | Soft limit: warn at 80%. Hard stop at 100%. Offer upgrade. |
| Pro | Soft limit: warn at 80%. Hard stop at 110% (10% grace). Offer upgrade or wait. |
| Enterprise | Soft limit: warn at 90%. No hard stop. Overage billed at 1.5x rate next cycle. |

**Grace period details:**
- Starter: 0% grace (hard stop)
- Pro: 10% grace (200 extra executions before hard stop)
- Enterprise: No limit, overage tracked and billed

---

## 5. Rate Limiting Strategy

### 5.1 Rate Limit Tiers

| Context | Free | Starter/Paid | Pro | Enterprise |
|---------|:----:|:------------:|:---:|:----------:|
| Chat Portal (free) | 5/min | — | — | — |
| Chat Portal (paid) | — | 30/min | 30/min | 60/min |
| Agent executions | 5/min | 15/min | 30/min | 60/min |
| Knowledge upload | 2/min | 5/min | 10/min | 20/min |
| API endpoints (general) | 30/min | 60/min | 60/min | 120/min |

### 5.2 Rate Limit Implementation

```typescript
// Dynamic throttle based on user tier
@Injectable()
export class DynamicThrottlerGuard extends ThrottlerGuard {
  async getLimit(context: ExecutionContext): Promise<number> {
    const user = this.getUser(context);
    const plan = await this.getPlan(user);

    const limits = {
      free: 5,
      starter: 15,
      pro: 30,
      enterprise: 60,
    };

    return limits[plan] ?? 5;
  }
}
```

### 5.3 Rate Limit Headers (Response)

```
X-RateLimit-Limit: 30
X-RateLimit-Remaining: 27
X-RateLimit-Reset: 1717430400 (Unix timestamp)
Retry-After: 45 (seconds, only on 429)
```

### 5.4 Burst Handling

- Allow short bursts above limit: **2x limit** for **5-second window**
- Example: Pro user at 30/min can burst to 60/min for 5s, then throttled
- Prevents legitimate rapid-fire during coding sessions
- Sliding window algorithm (not fixed window) to prevent boundary abuse

---

## 6. Token Budget System (AI Agents)

### 6.1 Token Counting

| Component | Counts Toward Budget |
|-----------|:--------------------:|
| User input tokens | ✅ |
| System prompt tokens | ❌ (platform cost) |
| Assistant output tokens | ✅ |
| Tool call tokens (input) | ✅ |
| Tool response tokens | ✅ |
| Reasoning/thinking tokens | ✅ (if billed by provider) |
| Cached/prompt-cache hits | ❌ (reduced cost) |

### 6.2 Budget Enforcement

```typescript
async checkTokenBudget(userId: string, estimatedTokens: number): Promise<{
  allowed: boolean;
  used: bigint;
  limit: bigint;
  remaining: bigint;
}> {
  const sub = await this.getSubscription(userId);
  const remaining = sub.maxTokensPerMonth - sub.tokensUsed;

  if (remaining < estimatedTokens) {
    return { allowed: false, used: sub.tokensUsed, limit: sub.maxTokensPerMonth, remaining };
  }

  return { allowed: true, used: sub.tokensUsed, limit: sub.maxTokensPerMonth, remaining };
}
```

### 6.3 Budget Warnings

| Threshold | Action |
|-----------|--------|
| 60% used | In-app notification: "You've used 60% of your monthly token budget" |
| 80% used | Warning banner in agent UI + email notification |
| 95% used | Urgent banner: "5% remaining. Upgrade or wait for reset." |
| 100% used | Hard stop (Starter/Pro) or overage billing (Enterprise) |

---

## 7. Spending Cap (Chat Portal)

### 7.1 User-Configurable Daily Cap

```typescript
// User settings
interface SpendingCap {
  enabled: boolean;
  dailyLimit: Decimal;  // e.g. $5.00
  warningThreshold: number; // percentage, default 80
}

// AppConfig or User preference table
model UserPreference {
  id              String   @id @default(uuid())
  userId          String   @unique
  dailySpendCap   Decimal? @db.Decimal(12, 6) // null = no cap
  capWarningPct   Int      @default(80)
  // ...
}
```

### 7.2 Spending Cap Logic

```typescript
async checkSpendingCap(userId: string): Promise<{ allowed: boolean; spent: Decimal; cap: Decimal }> {
  const pref = await this.getUserPreference(userId);
  if (!pref.dailySpendCap) return { allowed: true, spent, cap: null };

  const todaySpent = await this.getTodaySpend(userId); // sum of today's transactions
  const remaining = pref.dailySpendCap.sub(todaySpent);

  if (remaining.lte(0)) {
    return { allowed: false, spent: todaySpent, cap: pref.dailySpendCap };
  }

  // Warning at threshold
  const pctUsed = todaySpent.div(pref.dailySpendCap).mul(100).toNumber();
  if (pctUsed >= pref.capWarningPct) {
    this.emitWarning(userId, pctUsed);
  }

  return { allowed: true, spent: todaySpent, cap: pref.dailySpendCap };
}
```

### 7.3 Suggested Default Caps

| User Segment | Suggested Default | Can Override |
|--------------|:-----------------:|:-----------:|
| New users (first 7 days) | $2/day | Yes |
| Regular users | No cap | Yes |
| After overdraft event | $5/day (auto-set) | Yes |

---

## 8. Abuse Prevention

### 8.1 Multi-Account Abuse

| Signal | Detection | Action |
|--------|-----------|--------|
| Same IP, multiple free sessions | IP tracking (`MAX_SESSIONS_PER_IP = 3`) | Block new sessions from IP |
| Rapid session creation | Rate limit on session creation | 429 + temporary IP ban (1h) |
| Device fingerprint reuse | Browser fingerprint (optional) | Flag for review |
| Unusual usage pattern | >100 req in first hour of session | Auto-throttle to 2/min |

### 8.2 API Key Abuse (Paid Users)

| Signal | Detection | Action |
|--------|-----------|--------|
| Token/min spike >10x normal | Moving average comparison | Auto-throttle, alert ops |
| Concurrent requests >50 | Connection counter | Queue excess, 429 after 60s |
| Cost spike >$50 in 1 hour | Transaction sum monitoring | Pause account, notify user |
| Scraping pattern (identical prompts) | Prompt hash dedup | Block after 10 dupes |

### 8.3 Automated Defenses

```typescript
// Anomaly detection cron (every 5 minutes)
@Cron("*/5 * * * *")
async detectAnomalies() {
  // Users spending >$10 in last 5 min
  const highSpenders = await this.getHighSpenders(5 * 60_000, 10);
  for (const user of highSpenders) {
    await this.applyTemporaryThrottle(user.id, 5); // 5 req/min cap
    await this.notifyUser(user.id, "Unusual activity detected. Rate limited temporarily.");
    await this.alertOps(user);
  }
}
```

---

## 9. Quota Reset Schedule

| Quota Type | Reset Frequency | Reset Time | Method |
|------------|:---------------:|:----------:|--------|
| Free daily requests | Daily | 00:00 UTC (07:00 WIB) | Cron: `0 0 * * *` |
| Spending cap (daily) | Daily | 00:00 UTC | Check `createdAt` of today's transactions |
| Agent execution count | Monthly | Subscription renewal date | On billing cycle reset |
| Agent token budget | Monthly | Subscription renewal date | On billing cycle reset |
| Rate limit window | Per-minute | Rolling window | Sliding window TTL |
| IP session limit | Per-24h | Rolling window | Check `createdAt` of last 24h sessions |

---

## 10. Database Schema Additions

```prisma
// Extend existing PortalSession for chat portal quota
model PortalSession {
  // ... existing fields
  id            String    @id @default(uuid())
  sessionToken  String    @unique
  requestCount  Int       @default(0)
  ipAddress     String?
  userId        String?
  user          User?     @relation(fields: [userId], references: [id])
  lastRequestAt DateTime? @db.Timestamptz()
  lastResetAt   DateTime  @default(now()) @db.Timestamptz()
  createdAt     DateTime  @default(now()) @db.Timestamptz()

  // New fields for spending cap
  dailySpend    Decimal   @default(0) @db.Decimal(12, 6) @map("daily_spend")
  spendResetAt  DateTime  @default(now()) @db.Timestamptz() @map("spend_reset_at")
}

// User preferences for quota settings
model UserPreference {
  id              String   @id @default(uuid())
  userId          String   @unique
  user            User     @relation(fields: [userId], references: [id])
  dailySpendCap   Decimal? @db.Decimal(12, 6) @map("daily_spend_cap")
  capWarningPct   Int      @default(80) @map("cap_warning_pct")
  createdAt       DateTime @default(now()) @db.Timestamptz()
  updatedAt       DateTime @updatedAt @db.Timestamptz()

  @@map("user_preferences")
}

// Extend UserSubscription for agent quotas
model UserSubscription {
  // ... existing fields
  messagesUsed       Int      @default(0) @map("messages_used")
  tokensUsed         BigInt   @default(0) @map("tokens_used")
  currentPeriodStart DateTime @db.Timestamptz() @map("current_period_start")
  currentPeriodEnd   DateTime @db.Timestamptz() @map("current_period_end")
  maxExecutions      Int      @map("max_executions") // from plan
  maxTokens          BigInt   @map("max_tokens")     // from plan

  @@map("user_subscriptions")
}
```

---

## 11. API Response Formats

### 11.1 Quota Exceeded (Chat Portal)

```json
{
  "statusCode": 429,
  "error": "QuotaExceeded",
  "message": "Daily free request limit reached (20/20)",
  "data": {
    "type": "daily_limit",
    "used": 20,
    "limit": 20,
    "resetsAt": "2026-06-04T00:00:00Z",
    "upgradeUrl": "/settings/billing"
  }
}
```

### 11.2 Insufficient Balance

```json
{
  "statusCode": 402,
  "error": "InsufficientBalance",
  "message": "Balance too low for this model",
  "data": {
    "balance": "0.002400",
    "estimatedCost": "0.498000",
    "model": "claude-sonnet-4.6",
    "topUpUrl": "/settings/billing/topup"
  }
}
```

### 11.3 Agent Execution Limit

```json
{
  "statusCode": 429,
  "error": "ExecutionLimitReached",
  "message": "Monthly agent execution limit reached (500/500)",
  "data": {
    "type": "monthly_executions",
    "used": 500,
    "limit": 500,
    "plan": "starter",
    "resetsAt": "2026-07-03T00:00:00Z",
    "upgradeUrl": "/settings/subscription"
  }
}
```

### 11.4 Rate Limited

```json
{
  "statusCode": 429,
  "error": "TooManyRequests",
  "message": "Rate limit exceeded. Try again in 45 seconds.",
  "data": {
    "type": "rate_limit",
    "limit": 30,
    "remaining": 0,
    "retryAfter": 45,
    "resetAt": "2026-06-03T12:01:00Z"
  }
}
```

### 11.5 Spending Cap Hit

```json
{
  "statusCode": 429,
  "error": "SpendingCapReached",
  "message": "Daily spending cap reached ($5.00/$5.00)",
  "data": {
    "type": "spending_cap",
    "spent": "5.00",
    "cap": "5.00",
    "resetsAt": "2026-06-04T00:00:00Z",
    "adjustUrl": "/settings/spending-cap"
  }
}
```

---

## 12. Frontend Integration

### 12.1 Quota Status Endpoint

```
GET /api/v1/user/quota

Response:
{
  "chat": {
    "tier": "paid",
    "balance": "12.450000",
    "dailySpend": "1.23",
    "dailySpendCap": "5.00",
    "rateLimit": { "limit": 30, "remaining": 28, "resetAt": "..." }
  },
  "agents": {
    "plan": "pro",
    "executions": { "used": 423, "limit": 2000, "remaining": 1577 },
    "tokens": { "used": 8234512, "limit": 25000000, "remaining": 16765488 },
    "periodEnd": "2026-07-03T00:00:00Z"
  }
}
```

### 12.2 UI Components

| Component | Location | Behavior |
|-----------|----------|----------|
| Balance indicator | Chat header | Shows current balance, color-coded (green > $1, yellow < $1, red < $0.10) |
| Cost estimate | Above send button | "~Rp 150" or "~$0.008" before sending |
| Daily spend bar | Settings page | Progress bar of daily spend vs cap |
| Execution counter | Agent dashboard | "423/2,000 executions used" |
| Token budget bar | Agent dashboard | Progress bar with percentage |
| Rate limit toast | Global | "Slow down! Try again in X seconds" |
| Upgrade prompt | Modal | When hitting any hard limit |

---

## 13. Implementation Priority

### Phase 1 (With OpenRouter Migration)
- [x] Keep existing free tier quota (20/day) — already works
- [ ] Add `creditMultiplier` to billing logic
- [ ] Add per-model tier gating (balance check for chat, plan check for agents)
- [ ] Update rate limit to be tier-aware

### Phase 2 (Week After Migration)
- [ ] Add spending cap (user preference)
- [ ] Add token budget tracking for agent subscriptions
- [ ] Add monthly execution counter with reset logic
- [ ] Add quota status API endpoint

### Phase 3 (2 Weeks After)
- [ ] Frontend: cost estimate indicator
- [ ] Frontend: quota dashboard
- [ ] Anomaly detection cron
- [ ] Overage billing for Enterprise plan
- [ ] Rate limit headers in all responses
