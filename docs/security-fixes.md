# Security Fixes — Performa AI Backend

## Fix Priority & Implementation Guide

---

### 1. CRITICAL — Remove Hardcoded JWT Secret Fallback

**Files:** `apps/api/src/app/auth/auth.module.ts`, `apps/api/src/app/auth/strategy/jwt.strategy.ts` (removed by RX-114)

**Problem:** JWT secret defaults to `"change-me-in-production"` if `JWT_SECRET` env var is missing. Attackers can forge tokens.

**Fix:** Throw an error on startup if `JWT_SECRET` is not set.

```ts
// auth.module.ts
secret: config.getOrThrow<string>("JWT_SECRET"),

// jwt.strategy.ts
secretOrKey: configService.getOrThrow<string>("JWT_SECRET"),
```

---

### 2. CRITICAL — Migrate `$executeRawUnsafe` to Safe Prisma Queries

**File:** `apps/api/src/app/billing/service/billing.service.ts`

**Problem:** `$executeRawUnsafe` is fragile — future edits may introduce SQL injection via string concatenation.

**Fix:** Replace with `Prisma.sql` tagged template literals + `$executeRaw`.

```ts
// Before (unsafe pattern)
await this.prisma.$executeRawUnsafe(
  `UPDATE "users" SET balance = balance - $1 WHERE id = $2 AND balance >= $1`,
  estimatedCost, userId
);

// After (safe pattern)
import { Prisma } from "../../generated/prisma/client.js";

await this.prisma.$executeRaw(
  Prisma.sql`UPDATE "users" SET balance = balance - ${estimatedCost} WHERE id = ${userId} AND balance >= ${estimatedCost}`
);
```

Apply to all 5+ occurrences in `billing.service.ts` and the health check in `health.controller.ts`.

---

### 3. HIGH — Add Rate Limiting

**Files:** `apps/api/src/app/app.module.ts`, `apps/api/src/app/auth/controller/auth.controller.ts`, `apps/api/src/app/chat/controller/chat.controller.ts`

**Problem:** No rate limiting on auth (brute force) or chat (cost abuse) endpoints.

**Fix:** Install `@nestjs/throttler` and apply guards.

```bash
npm install @nestjs/throttler
```

```ts
// app.module.ts — register globally
import { ThrottlerModule, ThrottlerGuard } from "@nestjs/throttler";
import { APP_GUARD } from "@nestjs/core";

@Module({
  imports: [
    ThrottlerModule.forRoot([{
      ttl: 60000,   // 1 minute window
      limit: 60,    // 60 requests per minute (default)
    }]),
    // ... existing imports
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})

// auth.controller.ts — stricter limit on login/register
import { Throttle } from "@nestjs/throttler";

@Throttle({ default: { ttl: 60000, limit: 5 } })
@Post("login")

@Throttle({ default: { ttl: 60000, limit: 3 } })
@Post("register")

// chat.controller.ts — per-user limit
@Throttle({ default: { ttl: 60000, limit: 30 } })
@Post("completions")
```

---

### 4. HIGH — Stop Returning Raw API Keys in Responses

**File:** `apps/api/src/app/auth/service/auth.service.ts`

**Problem:** `register`, `getProfile`, and `regenerateApiKey` return the full API key in plain text.

**Fix:** Only show the full key once on creation/regeneration. Mask it in `getProfile`.

```ts
// Helper
function maskApiKey(key: string): string {
  return key.slice(0, 8) + "..." + key.slice(-4);
}

// getProfile — return masked key
apiKey: maskApiKey(user.apiKey),

// register & regenerateApiKey — return full key ONCE (clearly label it)
// These are acceptable since the user needs to copy the key.
// Add a warning in the response:
apiKeyWarning: "Store this key securely. It will not be shown again in full."
```

---

### 5. HIGH — Fix Login DTO Password Validation

**File:** `apps/api/src/app/auth/dto/create-auth.dto.ts`

**Problem:** `LoginDto` requires `password: z.string().min(1)` — inconsistent with register's `min(8)`.

**Fix:**

```ts
// LoginDto — match register validation
export const LoginDtoSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});
```

---

### 6. HIGH — Constant-Time API Key Comparison

**File:** `apps/api/src/common/guards/api-key.guard.ts`

**Problem:** Database lookup timing may leak whether a key prefix is valid.

**Fix:** Hash API keys before storage and compare hashes. Or use `crypto.timingSafeEqual` after lookup.

```ts
import { timingSafeEqual, createHash } from "crypto";

// Hash the incoming key and compare to stored hash
function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

// In guard: lookup by hashed key
const hashedKey = hashApiKey(apiKey);
const user = await this.prisma.user.findUnique({
  where: { apiKeyHash: hashedKey },
});
```

> **Note:** This requires a schema migration to add `apiKeyHash` column and backfill.

---

### 7. MEDIUM — Add Max Length to Chat Message Content

**File:** `apps/api/src/app/chat/dto/chat-completion.dto.ts`

**Problem:** No max length on message content — allows unbounded payloads causing DoS.

**Fix:**

```ts
export const ChatCompletionRequestSchema = z.object({
  model: z.string().min(1),
  messages: z
    .array(
      z.object({
        role: z.enum(["system", "user", "assistant"]),
        content: z.string().min(1).max(100_000), // ~100K chars ≈ ~25K tokens
      }),
    )
    .min(1)
    .max(100), // max 100 messages per request
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().min(1).max(128000).optional(),
});
```

---

### 8. MEDIUM — Atomic Balance Adjustment with Transaction

**File:** `apps/api/src/app/billing/service/billing.service.ts`

**Problem:** `adjustBalance()` runs multiple SQL statements non-atomically — race condition can cause negative balance.

**Fix:** Wrap in a Prisma `$transaction`.

```ts
async adjustBalance(userId: string, reserved: Decimal, actualCost: number) {
  const refund = reserved.minus(actualCost);

  await this.prisma.$transaction(async (tx) => {
    if (refund.gt(0)) {
      await tx.$executeRaw(
        Prisma.sql`UPDATE "users" SET balance = balance + ${refund.toNumber()} WHERE id = ${userId}`
      );
    } else if (refund.lt(0)) {
      const additional = refund.abs().toNumber();
      await tx.$executeRaw(
        Prisma.sql`UPDATE "users" SET balance = balance - ${additional} WHERE id = ${userId}`
      );
    }

    await tx.transaction.create({
      data: {
        userId,
        amount: actualCost,
        type: "deduction",
        status: "success",
      },
    });
  });
}
```

---

### 9. MEDIUM — Webhook Idempotency via Unique Constraint

**File:** `apps/api/src/app/webhooks/controller/webhook.controller.ts`, `prisma/schema.prisma`

**Problem:** Gap between existence check and insert allows double-credit on webhook replay.

**Fix:** Add a unique constraint on `reference` and use `upsert` or catch unique violation.

```prisma
model Transaction {
  // ... existing fields
  reference String? @unique  // Add unique constraint
}
```

```ts
// Use try/catch with Prisma unique constraint error
try {
  await this.prisma.transaction.create({
    data: { userId, amount, type: "topup", status: "success", reference: sessionId },
  });
  await this.billing.addBalance(userId, amount);
} catch (e) {
  if (e.code === "P2002") {
    // Already processed — idempotent return
    return;
  }
  throw e;
}
```

---

### 10. LOW — Add Security Headers with Helmet

**File:** `apps/api/src/main.ts`

**Fix:**

```bash
npm install @fastify/helmet
```

```ts
import helmet from "@fastify/helmet";

// In bootstrap()
await app.register(helmet, {
  contentSecurityPolicy: false, // disable CSP for API-only service
});
```

---

### 11. LOW — CSRF Protection

**File:** `apps/api/src/main.ts`

**Fix:** Since this is primarily an API consumed via API keys (not browser sessions), CSRF is lower risk. For browser-based dashboard calls:

```bash
npm install @fastify/csrf-protection
```

```ts
// Only needed if using cookie-based auth for dashboard
await app.register(csrfProtection);
```

For API-key-only endpoints, CSRF is not applicable.

---

### 12. LOW — Clean Up Dead Code

Remove unused files:
- `apps/api/src/app/auth/strategies/public.strategy.ts`
- `apps/api/src/app/auth/dto/update-auth.dto.ts`
- `apps/api/src/app/auth/repositories/auth.repository.ts`

---

## Implementation Order

| Phase | Items | Effort |
|-------|-------|--------|
| **Phase 1 — Ship blockers** | #1 JWT secret, #7 input limits, #5 login DTO | Small |
| **Phase 2 — High impact** | #3 rate limiting, #2 raw SQL, #4 API key masking | Medium |
| **Phase 3 — Hardening** | #8 atomic billing, #9 webhook idempotency, #6 key hashing | Medium |
| **Phase 4 — Polish** | #10 helmet, #11 CSRF, #12 dead code | Small |
