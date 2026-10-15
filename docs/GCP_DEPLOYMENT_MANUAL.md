# GCP Deployment Manual — Renovix AI

> Step-by-step guide for deploying Renovix AI to Google Cloud Platform.  
> Follow each section in order. Estimated time: ~45 minutes for first deploy.

---

## Prerequisites

- [Google Cloud SDK](https://cloud.google.com/sdk/docs/install) installed
- [Terraform](https://developer.hashicorp.com/terraform/install) >= 1.7 installed
- A GCP account with billing enabled
- Domain `renovix.id` owned (access to DNS settings)

---

## Step 1: Create GCP Project

```bash
# Create the project
gcloud projects create renovix-ai-prod --name="Renovix AI"

# Set as active project
gcloud config set project renovix-ai-prod

# Link billing account (get your billing account ID first)
gcloud billing accounts list
gcloud billing projects link renovix-ai-prod --billing-account=YOUR_BILLING_ACCOUNT_ID
```

---

## Step 2: Enable Required APIs

```bash
gcloud services enable \
  compute.googleapis.com \
  sqladmin.googleapis.com \
  run.googleapis.com \
  iap.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com \
  artifactregistry.googleapis.com \
  vpcaccess.googleapis.com \
  servicenetworking.googleapis.com \
  cloudresourcemanager.googleapis.com \
  iam.googleapis.com \
  storage.googleapis.com
```

---

## Step 3: Create Terraform State Bucket

```bash
# Create the bucket for Terraform remote state
gcloud storage buckets create gs://renovix-ai-terraform-state \
  --location=asia-southeast2 \
  --uniform-bucket-level-access

# Enable versioning (state backup)
gcloud storage buckets update gs://renovix-ai-terraform-state --versioning
```

---

## Step 4: Set Up Terraform Variables

```bash
cd infra/

# Copy the example file
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars`:

```hcl
project_id         = "renovix-ai-prod"
region             = "asia-southeast2"
environment        = "production"
domain             = "renovix.id"
db_tier            = "db-f1-micro"
db_password        = "GENERATE_A_STRONG_PASSWORD_HERE"
jwt_secret         = "GENERATE_A_STRONG_SECRET_HERE"
better_auth_secret = "GENERATE_A_STRONG_SECRET_HERE"
```

Generate strong values:

```bash
# Generate database password (32 chars)
openssl rand -base64 32

# Generate JWT secret (64 chars)
openssl rand -base64 64

# Generate Better Auth secret (64 chars)
openssl rand -base64 64
```

---

## Step 4.5: Configure Application Default Credentials (Required)

Terraform uses Google Application Default Credentials for the GCS backend.
Your gcloud account can be logged in while ADC is still missing.

Run this once:

```bash
gcloud auth application-default login
gcloud auth application-default set-quota-project renovix-ai-prod
```

Verify ADC is ready:

```bash
gcloud auth application-default print-access-token >/dev/null && echo "ADC ready"
```

---

## Step 5: Run Terraform

```bash
cd infra/

# Initialize Terraform (downloads providers)
terraform init

# Preview what will be created
terraform plan
```

For first deployment, use two phases so Cloud Run services don't fail on missing images.

Phase A: create Artifact Registry first

```bash
terraform apply -target=module.cloud_run.google_artifact_registry_repository.images
```

Phase B: build and push images (Step 8), then run full apply

```bash
terraform apply
```

**This creates:**
- VPC + private subnet + VPC connector
- Cloud SQL PostgreSQL 16 (private IP only)
- GCS bucket + CDN backend
- Secret Manager entries
- Cloud Run services (will fail until images exist — that's OK)
- Artifact Registry
- Global Load Balancer + SSL certificate
- Static IP address

---

## Step 6: Set Manual Secrets (OAuth + API Keys)

After `terraform apply`, some secrets are **auto-populated** and some need **manual setup**.

**Required before the first deploy (RX-110).** Outside `NODE_ENV` development/test the API refuses to start when `JWT_SECRET`, `BETTER_AUTH_SECRET`, `IP_HASH_SECRET`, `MCP_OAUTH_STATE_SECRET` (RX-151, signs the MCP OAuth state) or `MCP_ENCRYPTION_KEY` is missing, empty, a dev-only or placeholder value from `.env.example`, or shorter than 32 characters; `MCP_ENCRYPTION_KEY` must be exactly 32 bytes (`openssl rand -hex 32`). The error names the variable, never its value. Put each in Secret Manager once, before the first deploy: changing `MCP_ENCRYPTION_KEY` later makes every user reconnect their MCP tools (key rotation is a later feature).

### Auto-Populated by Terraform (no action needed)

| Secret | Source | Used By |
|--------|--------|---------|
| `database-url` | Cloud SQL module | API (Prisma) |
| `jwt-secret` | `terraform.tfvars` | API (JWT auth) |
| `better-auth-secret` | `terraform.tfvars` | API (Better Auth sessions) |
| `google-oauth-client-id` | OAuth module (`google_iap_client`) | API (Google SSO) |
| `google-oauth-client-secret` | OAuth module (`google_iap_client`) | API (Google SSO) |
| `mcp-google-client-id` | OAuth module (`google_iap_client`) | API (MCP Gmail/Calendar/Sheets) |
| `mcp-google-client-secret` | OAuth module (`google_iap_client`) | API (MCP Gmail/Calendar/Sheets) |
| `mcp-encryption-key` | `terraform.tfvars` | API (encrypts MCP tokens in DB) |

### Manual Secrets (set after `terraform apply`)

#### GitHub OAuth (SSO login)

1. Create an OAuth App at https://github.com/settings/developers
2. Set **Authorization callback URL** to: `https://api.renovix.id/api/auth/better/callback/github`

```bash
echo -n "Iv1.your_client_id" | \
  gcloud secrets versions add github-oauth-client-id --data-file=-

echo -n "your_client_secret" | \
  gcloud secrets versions add github-oauth-client-secret --data-file=-
```

#### Slack OAuth (MCP integration)

1. Create an app at https://api.slack.com/apps
2. Add **Redirect URL**: `https://api.renovix.id/api/mcp/callback/slack`
3. Add scopes: `channels:read`, `chat:write`, `users:read`

```bash
echo -n "your_slack_client_id" | \
  gcloud secrets versions add mcp-slack-client-id --data-file=-

echo -n "your_slack_client_secret" | \
  gcloud secrets versions add mcp-slack-client-secret --data-file=-
```

#### Together AI API Key

```bash
echo -n "your-together-api-key" | \
  gcloud secrets versions add together-api-key --data-file=-
```

#### Stripe (set when re-enabling payments)

```bash
# echo -n "sk_live_xxx" | gcloud secrets versions add stripe-secret-key --data-file=-
# echo -n "whsec_xxx" | gcloud secrets versions add stripe-webhook-secret --data-file=-
```

#### S3/GCS HMAC Keys (from Terraform output)

```bash
terraform output -raw hmac_access_id | \
  gcloud secrets versions add s3-access-key-id --data-file=-

terraform output -raw hmac_secret | \
  gcloud secrets versions add s3-secret-access-key --data-file=-
```

### Verify All Secrets

```bash
gcloud secrets list --format="table(name, createTime)"
# Confirm each has at least 1 version:
gcloud secrets versions list database-url
gcloud secrets versions list google-oauth-client-id
gcloud secrets versions list mcp-google-client-id
gcloud secrets versions list github-oauth-client-id
gcloud secrets versions list mcp-slack-client-id
gcloud secrets versions list mcp-encryption-key
gcloud secrets versions list together-api-key
gcloud secrets versions list s3-access-key-id
```

---

## Step 7: Configure DNS

Get the static IP from Terraform:

```bash
terraform output -raw lb_ip
# Example: 34.120.xxx.xxx
```

Set these DNS records at your domain registrar (e.g., Niagahoster, Cloudflare):

| Type | Name | Value | TTL |
|------|------|-------|-----|
| A | `@` (renovix.id) | `34.120.xxx.xxx` | 300 |
| A | `www` | `34.120.xxx.xxx` | 300 |
| A | `api` | `34.120.xxx.xxx` | 300 |
| A | `chat` | `34.120.xxx.xxx` | 300 |
| A | `dashboard` | `34.120.xxx.xxx` | 300 |
| A | `cdn` | `34.120.xxx.xxx` | 300 |

> **Note:** SSL certificate provisioning takes 15-30 minutes after DNS propagates. Check status:
> ```bash
> gcloud compute ssl-certificates describe renovix-ssl-cert --format="get(managed.status)"
> ```

---

## Step 8: First Image Build & Deploy

Push your first images manually (after this, Cloud Build handles it automatically):

```bash
# Authenticate Docker with Artifact Registry
gcloud auth configure-docker asia-southeast2-docker.pkg.dev

# Build & push from monorepo root
docker build -f apps/api/Dockerfile \
  -t asia-southeast2-docker.pkg.dev/renovix-ai-prod/renovix/api:latest .

docker build -f apps/chat/Dockerfile \
  --build-arg NEXT_PUBLIC_API_URL=https://api.renovix.id \
  -t asia-southeast2-docker.pkg.dev/renovix-ai-prod/renovix/chat:latest .

docker build -f apps/landing/Dockerfile \
  -t asia-southeast2-docker.pkg.dev/renovix-ai-prod/renovix/landing:latest .

# Push all images
docker push asia-southeast2-docker.pkg.dev/renovix-ai-prod/renovix/api:latest
docker push asia-southeast2-docker.pkg.dev/renovix-ai-prod/renovix/chat:latest
docker push asia-southeast2-docker.pkg.dev/renovix-ai-prod/renovix/landing:latest
```

---

## Step 9: Run Database Migration

```bash
# Use Cloud SQL Proxy to connect locally and run migration
# Option 1: Via Cloud Build (recommended)
gcloud builds submit --config=cloudbuild.yaml --substitutions=SHORT_SHA=initial

# Option 2: Manually via Cloud SQL Proxy
gcloud sql connect renovix-db-asia-southeast2 --user=renovix_app --database=renovix_ai
# Then run: npx prisma migrate deploy
```

---

## Step 10: Set Up Cloud Build Trigger (CI/CD)

```bash
# Connect your GitHub repo
gcloud builds triggers create github \
  --name="renovix-deploy-production" \
  --repo-name="renovix-ai" \
  --repo-owner="YOUR_GITHUB_USERNAME" \
  --branch-pattern="^main$" \
  --build-config="cloudbuild.yaml" \
  --substitutions="_REGION=asia-southeast2,_DOMAIN=renovix.id"
```

Grant Cloud Build permission to deploy:

```bash
PROJECT_NUMBER=$(gcloud projects describe renovix-ai-prod --format='value(projectNumber)')

# Cloud Build → Cloud Run deploy permission
gcloud projects add-iam-policy-binding renovix-ai-prod \
  --member="serviceAccount:${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com" \
  --role="roles/run.admin"

# Cloud Build → Act as service accounts
gcloud projects add-iam-policy-binding renovix-ai-prod \
  --member="serviceAccount:${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"

# Cloud Build → Access secrets
gcloud projects add-iam-policy-binding renovix-ai-prod \
  --member="serviceAccount:${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

---

## Step 11: Verify Deployment

```bash
# Check Cloud Run services are running
gcloud run services list --region=asia-southeast2

# Test API health
curl https://api.renovix.id/api/health

# Check SSL certificate status
gcloud compute ssl-certificates describe renovix-ssl-cert

# View logs
gcloud run services logs read renovix-api --region=asia-southeast2 --limit=50
```

---

## Ongoing Operations

### View Logs

```bash
# API logs
gcloud run services logs read renovix-api --region=asia-southeast2

# All services
gcloud logging read "resource.type=cloud_run_revision" --limit=100
```

### Rollback a Deployment

```bash
# List revisions
gcloud run revisions list --service=renovix-api --region=asia-southeast2

# Rollback to previous revision
gcloud run services update-traffic renovix-api \
  --region=asia-southeast2 \
  --to-revisions=renovix-api-PREVIOUS_REVISION=100
```

### Scale Up Database

```bash
# When you outgrow db-f1-micro (>100 concurrent connections)
# Update db_tier in terraform.tfvars:
# db_tier = "db-custom-1-3840"
terraform apply
```

### Rotate Secrets

```bash
# Generate new JWT secret
NEW_SECRET=$(openssl rand -base64 64)

# Add new version (old version still works until you disable it)
echo -n "$NEW_SECRET" | gcloud secrets versions add jwt-secret --data-file=-

# Deploy new revision to pick up the new secret
gcloud run services update renovix-api --region=asia-southeast2

# Disable old version after confirming new one works
gcloud secrets versions disable jwt-secret --version=1
```

### Migrate Existing S3 Data to GCS

```bash
# If you have existing data in AWS S3 / MinIO:
gsutil -m rsync -r s3://your-old-bucket gs://renovix-ai-storage-renovix-ai-prod
```

---

## Cost Monitoring

```bash
# Set up budget alert ($40/month)
gcloud billing budgets create \
  --billing-account=YOUR_BILLING_ACCOUNT_ID \
  --display-name="Renovix Monthly Budget" \
  --budget-amount=40USD \
  --threshold-rule=percent=80 \
  --threshold-rule=percent=100
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| SSL cert stuck in PROVISIONING | DNS not propagated yet. Wait 30min, verify A records point to LB IP |
| Cloud Run deploy fails "image not found" | Push images first (Step 8) before terraform apply creates services |
| Terraform init fails with "could not find default credentials" | Run Step 4.5 to set up ADC, then run `terraform init -reconfigure` |
| Cloud SQL connection refused | Check VPC connector is healthy: `gcloud vpc-access connectors describe renovix-connector --region=asia-southeast2` |
| 403 on Cloud Run | Verify IAM `allUsers` invoker binding exists |
| Secret "not found" errors | Verify secret names: `gcloud secrets list` (they use kebab-case: `together-api-key`) |
| Build OOM | Increase Cloud Build machine type in `cloudbuild.yaml` |

---

## File Structure Created

```
infra/
├── .gitignore              # Ignores .terraform/, *.tfstate, *.tfvars
├── main.tf                 # Root module wiring
├── variables.tf            # Input variables
├── outputs.tf              # Output values
├── versions.tf             # Provider + backend config
├── terraform.tfvars.example
└── modules/
    ├── networking/         # VPC, subnet, VPC connector, peering
    ├── database/           # Cloud SQL PostgreSQL 16 + pgvector
    ├── storage/            # GCS bucket, HMAC keys, CDN backend
    ├── cloud-run/          # 4 services, service accounts, IAM, registry
    ├── security/           # Secret Manager (auto + manual secrets)
    └── cdn/                # SSL, NEGs, URL map, LB, HTTP→HTTPS redirect

cloudbuild.yaml             # CI/CD: parallel builds → push → migrate → deploy
apps/api/Dockerfile         # Hardened: non-root, dumb-init, healthcheck
apps/chat/Dockerfile        # NEW: production Next.js container
apps/landing/Dockerfile     # Hardened: non-root, dumb-init, healthcheck
apps/*/next.config.js       # Security headers, CSP, standalone output
```
