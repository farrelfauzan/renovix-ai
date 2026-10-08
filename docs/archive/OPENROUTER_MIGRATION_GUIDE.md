# OpenRouter Migration Guide

This document provides a comprehensive guide for migrating the Renovix AI platform from Together AI to OpenRouter, including database migrations, infrastructure changes, and deployment strategy.

---

## 1. What Has Been Automated in Code

The following changes have been fully implemented in the codebase and will be automatically applied upon deployment:

### 1.1. Provider Adapter Replacement
- **Removed**: `TogetherAdapter` (`apps/api/src/app/providers/together.adapter.ts`)
- **Added**: `OpenRouterAdapter` (`apps/api/src/app/providers/openrouter.adapter.ts`)
  - Uses `https://openrouter.ai/api/v1/chat/completions`
  - Includes required `HTTP-Referer` and `X-Title` headers
  - Preserves streaming, tool-calling, and reasoning model support

### 1.2. Provider Router Simplification
- Updated `ProviderRouter` to exclusively route through `OpenRouterAdapter`.

### 1.3. Database Schema Updates
- Updated `prisma/schema.prisma` for the `AiModel` model:
  - Added `tier` (String, default: "standard")
  - Added `creditMultiplier` (Decimal, default: 1.0)
  - Added `planRequired` (String, default: "free")
  - Added `maxOutputTokens` (Int, optional)
  - Added indexes on `tier` and `[active, tier]` for performance.

### 1.4. Billing & Cost Calculation
- Updated `BillingService` (`estimateCost` and `calculateActualCost`) to multiply the base token cost by the model's `creditMultiplier`.
- Updated `ModelRegistryService` to expose `creditMultiplier`, `tier`, and `planRequired` in the `ModelConfig` interface.
- Updated `ChatService` to pass the `creditMultiplier` into billing calculations.

### 1.5. Seed Data Overhaul
- Replaced all 24 Together AI models in `prisma/seed.ts` with 16 curated OpenRouter models across 4 tiers (Standard, Pro, Premium, Ultra) with accurate pricing and multipliers.

### 1.6. Environment Variables
- Updated `.env.example` to replace `TOGETHER_API_KEY` with:
  - `OPENROUTER_API_KEY`
  - `OPENROUTER_APP_TITLE` (default: "Renovix AI")
  - `OPENROUTER_APP_URL` (default: "https://chat.renovix.id")

---

## 2. Manual Setup & Database Migration (Cloud SQL)

While the Prisma schema is updated, you must apply the migration to your production Cloud SQL database.

### Step 2.1: Update Environment Variables
1. Fill in your actual OpenRouter API key in your local `.env` and production Secret Manager:
   ```env
   OPENROUTER_API_KEY="sk-or-v1-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
   OPENROUTER_APP_TITLE="Renovix AI"
   OPENROUTER_APP_URL="https://chat.renovix.id"
   ```
2. **Do not remove** `TOGETHER_API_KEY` from production secrets just yet. Keep it as a fallback until the migration is verified stable (see Rollback Strategy).

### Step 2.2: Apply Prisma Migration to Cloud SQL
Connect to your production Cloud SQL instance using the Cloud SQL Auth Proxy and apply the migration.

```bash
# 1. Start the Cloud SQL Auth Proxy in the background
cloud-sql-proxy renovix-ai-prod:asia-southeast2:renovix-db-asia-southeast2 &

# 2. Run the Prisma migration deploy
# Ensure your DATABASE_URL points to the proxied local port
DATABASE_URL="postgresql://renovix_app:YOUR_DB_PASSWORD@localhost:5432/renovix_ai?schema=public" \
  npx prisma migrate deploy

# 3. (Optional but recommended) Seed the new OpenRouter models
DATABASE_URL="postgresql://renovix_app:YOUR_DB_PASSWORD@localhost:5432/renovix_ai?schema=public" \
  npx prisma db seed
```
*Note: The `prisma migrate deploy` command will automatically generate and apply the SQL to add the new columns (`tier`, `credit_multiplier`, `max_output_tokens`, `plan_required`) and the indexes to the `ai_models` table.*

### Step 2.3: Update GCP Secret Manager
You can automate this via Terraform, or do it manually via the GCP Console:

1. **Create the new secret**:
   ```bash
   echo -n "sk-or-v1-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" | gcloud secrets create openrouter-api-key \
     --project=renovix-ai-prod \
     --replication-policy="automatic" \
     --data-file=-
   ```
2. **Grant access to the API Service Account**:
   ```bash
   gcloud secrets add-iam-policy-binding openrouter-api-key \
     --project=renovix-ai-prod \
     --member="serviceAccount:renovix-api-sa@renovix-ai-prod.iam.gserviceaccount.com" \
     --role="roles/secretmanager.secretAccessor"
   ```
3. **Update Terraform** (`infra/modules/cloud-run/main.tf`):
   Replace the `TOGETHER_API_KEY` environment variable block with `OPENROUTER_API_KEY`, `OPENROUTER_APP_TITLE`, and `OPENROUTER_APP_URL` pointing to the new secret.
4. Run `terraform apply` to update the Cloud Run service environment variables.

---

## 3. Deployment Strategy

The existing CI/CD pipeline (`.github/workflows/deploy.yml` or `cloudbuild.yaml`) requires **no changes**. The deployment flow remains:

1. Push a new git tag (e.g., `v1.2.0`).
2. GitHub Actions/Cloud Build triggers, builds the Docker image (which now includes `OpenRouterAdapter`), and pushes to Artifact Registry.
3. Cloud Run service `renovix-api` is updated with the new image.
4. Cloud Run automatically picks up the new environment variables (if Terraform was applied).

### Zero-Downtime Consideration
Because the `ProviderRouter` now *only* knows about `openrouter`, deploying the new code **before** the database migration and seed data are complete will cause 500 errors (models won't be found or provider will be mismatched). 

**Strict Deployment Order:**
1. [x] Code changes merged to `main`.
2. [ ] Apply Prisma migration to Cloud SQL (`npx prisma migrate deploy`).
3. [ ] Seed new OpenRouter models (`npx prisma db seed`).
4. [ ] Update GCP Secret Manager with `OPENROUTER_API_KEY`.
5. [ ] Run `terraform apply` to update Cloud Run env vars.
6. [ ] Trigger deployment (push tag `v<semver>`).

---

## 4. Rollback Strategy

If OpenRouter experiences downtime or unexpected behavior post-deployment, you have two rollback options:

### Option A: Quick Image Revert (Recommended)
Immediately revert the Cloud Run service to the previous stable image. This takes ~30 seconds and requires no code changes.
```bash
gcloud run services update renovix-api \
  --project=renovix-ai-prod \
  --region=asia-southeast2 \
  --image=asia-southeast2-docker.pkg.dev/renovix-ai-prod/renovix/api:<PREVIOUS_SHA_OR_TAG>
```

### Option B: Feature Flag (Future-Proofing)
For future migrations, consider adding an `AppConfig` key (e.g., `active_provider = "openrouter" | "together"`). The `ProviderRouter` could read this at runtime to dynamically switch adapters without a new deployment. *(Not implemented in this PR to keep scope minimal, but highly recommended for the next iteration).*

---

## 5. Post-Deployment Verification Checklist

- [ ] **Health Check**: `curl https://api.renovix.id/api/health` returns 200 OK.
- [ ] **Model List**: Call `GET /api/v1/chat/models` and verify the 16 new OpenRouter models are returned with correct tiers and multipliers.
- [ ] **Standard Model Test**: Send a chat completion request using `deepseek-v4-flash`. Verify it succeeds and usage is logged.
- [ ] **Premium Model Test**: Send a chat completion request using `claude-sonnet-4.6` (ensure test user has sufficient balance). Verify the cost deducted matches `(input_tokens * input_price + output_tokens * output_price) * 10`.
- [ ] **Streaming Test**: Verify SSE streaming works correctly for chat completions.
- [ ] **Logs**: Monitor Cloud Run logs (`gcloud beta run services logs tail renovix-api --region=asia-southeast2`) for any `OpenRouter stream error` or 429 rate limits.
- [ ] **Billing Dashboard**: Verify that the user's balance deduction reflects the new `creditMultiplier` logic.

---

## 6. Cleanup (After 7 Days of Stability)

Once the migration is confirmed stable in production for at least one week:
1. Delete the `together-api-key` secret from GCP Secret Manager.
2. Remove any lingering references to "Together" in `terraform.tfvars` or documentation.
3. Consider implementing the `active_provider` feature flag for easier future provider swaps.
