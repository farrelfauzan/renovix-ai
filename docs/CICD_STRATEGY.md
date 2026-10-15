# CI/CD Strategy — Renovix AI

> GitHub Actions + GCP Cloud Build for monorepo CI/CD  
> Region: `asia-southeast2` | Project: `renovix-ai-prod`  
> Registry: `asia-southeast2-docker.pkg.dev/renovix-ai-prod/renovix`

---

## Overview

| Trigger | Action | Purpose |
|---------|--------|---------|
| PR opened/updated | Test build (Docker build only, no push) | Validate code compiles & Docker image builds |
| Push to `main` | Test build (Docker build only, no push) | Ensure main is always green |
| Release tag `v*` | Build + Push + Deploy to Cloud Run | Production deployment |

---

## Change Detection Strategy

Since this is an Nx monorepo, we use **path-based filtering** to determine which apps are affected:

| Path pattern | Affected app |
|---|---|
| `apps/api/**`, `prisma/**`, `libs/**` | `api` |
| `apps/chat/**`, `libs/**` | `chat` |
| `apps/landing/**`, `libs/**` | `landing` |
| `package.json`, `tsconfig.base.json` | all |

> **Note:** Changes to `libs/**` trigger all apps since shared libs can affect any consumer. Changes to root config files (`package.json`, `tsconfig.base.json`) also trigger all apps.

---

## Tag Convention for Deployment

Release tags MUST follow this format:

```
v<version>                    → deploys ALL apps
v<version>-api                → deploys only API
v<version>-chat               → deploys only Chat
v<version>-landing            → deploys only Landing
```

Examples:
- `v1.2.0` → builds & deploys all 3 services
- `v1.2.1-api` → builds & deploys only the API
- `v1.2.1-chat` → builds & deploys only the Chat app
- `v1.2.1-landing` → builds & deploys only Landing

---

## Pipeline Architecture

### 1. PR / Push to Main — Test Build

```
┌─────────────────────────────────────────────────────────┐
│  GitHub Actions: ci.yml                                 │
├─────────────────────────────────────────────────────────┤
│  Trigger: PR to main / push to main                    │
│                                                         │
│  ┌───────────────┐                                     │
│  │ Detect Changes│ ← uses dorny/paths-filter           │
│  └───────┬───────┘                                     │
│          │                                              │
│  ┌───────▼───────────────────────────────────┐         │
│  │ Matrix Build (only affected apps)         │         │
│  │  ┌─────┐  ┌──────┐  ┌─────┐            │         │
│  │  │ API │  │ Chat │  │Land.│            │         │
│  │  └─────┘  └──────┘  └─────┘            │         │
│  │  docker build (no push) — validates build │         │
│  └───────────────────────────────────────────┘         │
│                                                         │
│  ┌───────────────┐                                     │
│  │ Lint + Test   │ ← nx affected:lint, affected:test   │
│  └───────────────┘                                     │
└─────────────────────────────────────────────────────────┘
```

### 2. Release Tag — Deploy to Cloud Run

```
┌─────────────────────────────────────────────────────────┐
│  GitHub Actions: deploy.yml                             │
├─────────────────────────────────────────────────────────┤
│  Trigger: tag push v*                                   │
│                                                         │
│  ┌──────────────────┐                                  │
│  │ Parse tag suffix  │ ← determine which app(s)        │
│  └────────┬─────────┘                                  │
│           │                                             │
│  ┌────────▼────────────────────────────────┐           │
│  │ Build + Push Images (parallel)          │           │
│  │  → asia-southeast2-docker.pkg.dev/      │           │
│  │    renovix-ai-prod/renovix/<app>:<tag>  │           │
│  └────────┬────────────────────────────────┘           │
│           │                                             │
│  ┌────────▼────────────────────────────────┐           │
│  │ Run Prisma Migrate (if API affected)    │           │
│  └────────┬────────────────────────────────┘           │
│           │                                             │
│  ┌────────▼────────────────────────────────┐           │
│  │ Deploy to Cloud Run (gcloud run deploy) │           │
│  │  • renovix-api                          │           │
│  │  • renovix-chat                         │           │
│  │  • renovix-landing                      │           │
│  └─────────────────────────────────────────┘           │
└─────────────────────────────────────────────────────────┘
```

---

## Cloud Run Service Mapping

| App | Cloud Run Service | Port | Image Tag |
|-----|-------------------|------|-----------|
| API | `renovix-api` | 3000 | `renovix/api:<tag>` |
| Chat | `renovix-chat` | 3000 | `renovix/chat:<tag>` |
| Landing | `renovix-landing` | 3001 | `renovix/landing:<tag>` |

---

## Build Args (Required at Docker Build Time)

Next.js apps bake env vars at build time. These MUST be passed as `--build-arg`:

| App | Build Arg | Value |
|-----|-----------|-------|
| Chat | `NEXT_PUBLIC_API_URL` | `https://api.renovix.id/api/v1` |
| Landing | _(none)_ | — |

> **Critical:** The URL must include `/api/v1` suffix. The API sets `app.setGlobalPrefix("api")` and routes are versioned under `/v1`. Without this, the frontend calls `https://api.renovix.id/chat/portal/usage` which 404s.

---

## Known Build Requirements

| Requirement | Reason |
|-------------|--------|
| `--legacy-peer-deps` in npm install | React 19 vs `@emoji-mart/react@1.1.1` peer dependency conflict |
| Prisma generate before webpack | Webpack resolves `@generated/prisma/client.js` at compile time |
| Build context must be monorepo root | Dockerfiles use `COPY . .` to access all workspace files |
| `E2_HIGHCPU_8` machine type | Webpack bundling + Next.js build are memory/CPU intensive |

---

## Cloud Run Environment Variables

### Plain env vars (set once, preserved across deploys):

| Var | Service | Value |
|-----|---------|-------|
| `NODE_ENV` | api | `production` |
| `CORS_ORIGIN` | api | `https://chat.renovix.id,https://dashboard.renovix.id,https://renovix.id,https://www.renovix.id` |
| `GCS_BUCKET` | api | `renovix-ai-storage-renovix-ai-prod` |
| `S3_ENDPOINT` | api | `https://storage.googleapis.com` |
| `S3_REGION` | api | `asia-southeast2` |
| `S3_BUCKET` | api | `renovix-ai-storage-renovix-ai-prod` |
| `S3_CDN_DOMAIN` | api | `cdn.renovix.id` |
| `API_PUBLIC_URL` | api | `https://api.renovix.id` |
| `DASHBOARD_URL` | api | `https://dashboard.renovix.id` |
| `CHAT_APP_URL` | api | `https://chat.renovix.id` |

### Secret env vars (mounted from Secret Manager):

`DATABASE_URL`, `JWT_SECRET`, `BETTER_AUTH_SECRET`, `TOGETHER_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`, `MCP_GOOGLE_CLIENT_ID`, `MCP_GOOGLE_CLIENT_SECRET`, `MCP_SLACK_CLIENT_ID`, `MCP_SLACK_CLIENT_SECRET`

> **Important:** Deploy steps use `--image` only (never `--set-env-vars`). Using `--set-env-vars` wipes all existing env vars including secrets. Use `--update-env-vars` with `^||^` delimiter prefix to add new vars with commas in values.

---

## GitHub Secrets Required

| Secret | Description |
|--------|-------------|
| `GCP_PROJECT_ID` | `renovix-ai-prod` |
| `GCP_SA_KEY` | Service account JSON key with Cloud Run Admin, Artifact Registry Writer, Secret Manager Accessor |
| `GCP_REGION` | `asia-southeast2` |
| `DATABASE_URL` | PostgreSQL connection string (for prisma migrate in deploy) |

---

## File Structure

```
.github/
├── workflows/
│   ├── ci.yml          # PR + push to main: lint, test, docker build
│   └── deploy.yml      # Release tag: build, push, deploy to Cloud Run
```

---

## CI Workflow (`ci.yml`) — Details

**Triggers:**
- `pull_request` → branches: `main`
- `push` → branches: `main`

**Jobs:**

1. **detect-changes** — Determine which apps have changes
2. **lint-test** — Run `nx affected --target=lint` and `nx affected --target=test`
3. **build-api** — Docker build (no push) for API (if affected)
4. **build-chat** — Docker build (no push) for Chat (if affected)
5. **build-landing** — Docker build (no push) for Landing (if affected)

> Docker builds run in parallel. Only affected apps are built to save CI minutes.

---

## Deploy Workflow (`deploy.yml`) — Details

**Trigger:**
- `push` → tags: `v*`

**Jobs:**

1. **parse-tag** — Extract version and app suffix from tag
2. **build-push** — Build Docker image + push to Artifact Registry (matrix for affected apps)
3. **migrate** — Run `prisma migrate deploy` if API is being deployed
4. **deploy** — `gcloud run services update` for each affected service

---

## Estimated CI Times

| Step | Duration |
|------|----------|
| Detect changes | ~10s |
| Lint + Test | ~1-3 min |
| Docker build (API) | ~3-5 min |
| Docker build (Next.js apps) | ~3-6 min |
| Push to Artifact Registry | ~1 min |
| Prisma migrate | ~30s |
| Cloud Run deploy | ~30s per service |

**Total PR check:** ~4-7 min (parallel builds)  
**Total deploy:** ~6-10 min

---

## Rollback Strategy

If a deployment fails or introduces a bug:

```bash
# Option 1: Route traffic back to previous revision
gcloud run services update-traffic renovix-<app> \
  --to-revisions=<previous-revision>=100 \
  --region=asia-southeast2 \
  --project=renovix-ai-prod

# Option 2: Redeploy previous image tag
gcloud run services update renovix-<app> \
  --image=asia-southeast2-docker.pkg.dev/renovix-ai-prod/renovix/<app>:<previous-tag> \
  --region=asia-southeast2 \
  --project=renovix-ai-prod
```

Or re-tag and push a previous working version:
```bash
git tag v1.2.2-api  # points to last known good commit
git push origin v1.2.2-api
```

> **Gotcha:** Never use `--set-env-vars` during rollback — it replaces ALL env vars. Only use `--image` to swap the container image.

---

## Decision: GitHub Actions vs Cloud Build

| Criteria | GitHub Actions | Cloud Build |
|----------|---------------|-------------|
| Trigger flexibility | ✅ Tag suffix parsing, path filters | ⚠️ Limited tag filtering |
| PR status checks | ✅ Native | ⚠️ Requires GitHub app |
| Cost | ✅ Free for public repos, 2000 min/mo private | ⚠️ Pay per build min |
| GCP integration | ✅ via `google-github-actions/auth` | ✅ Native |
| Monorepo support | ✅ Path filters + matrix | ⚠️ Manual scripting |
| Caching | ✅ Docker layer cache action | ⚠️ Kaniko cache |

**Decision: GitHub Actions** — Better monorepo support, tag parsing, PR integration, and free tier.

The existing `cloudbuild.yaml` is preserved for manual/emergency deploys via `gcloud builds submit`.

---

## Approval Checklist

- [ ] Tag convention (`v*-<app>`) acceptable?
- [ ] `libs/**` changes triggering all apps — acceptable or too broad?
- [ ] GitHub Actions as CI platform (vs Cloud Build triggers)?
- [ ] Secrets setup approach (GCP SA key in GitHub Secrets)?
- [ ] Rollback strategy sufficient?

---

Please review and confirm or suggest changes before I implement the workflows.
