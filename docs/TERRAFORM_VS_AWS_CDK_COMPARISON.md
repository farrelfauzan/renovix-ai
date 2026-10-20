# Terraform (GCP) vs AWS CDK — Infrastructure Comparison

> Context: Production deployment for an app serving **1–100 users**, located in **Indonesia**.

---

## 1. Region & Latency (Indonesia)

| Criteria | Terraform + GCP | AWS CDK |
|----------|----------------|---------|
| Nearest Region | `asia-southeast2` (Jakarta 🇮🇩) | `ap-southeast-3` (Jakarta 🇮🇩) |
| Next Nearest | `asia-southeast1` (Singapore) | `ap-southeast-1` (Singapore) |
| Local Latency | ~5–15ms (Jakarta) | ~5–15ms (Jakarta) |
| Data Residency | ✅ Jakarta available | ✅ Jakarta available |

**Verdict:** Both have Jakarta regions. GCP Jakarta launched earlier and has more mature services there.

---

## 2. Budget Estimate (1–100 Users, First Production)

### GCP (Terraform)

| Service | Spec | Monthly Cost (USD) |
|---------|------|--------------------|
| Cloud Run (container) | 1 vCPU, 512MB, ~50k requests | **$0–5** (free tier covers most) |
| Cloud SQL (PostgreSQL) | db-f1-micro, 10GB | **$7–10** |
| Cloud Storage | 5GB | **$0.10** |
| Cloud CDN + Load Balancer | Basic | **$18–25** |
| Secret Manager | 10 secrets | **$0.06** |
| Artifact Registry | 5GB container images | **$0.50** |
| **Total** | | **~$26–41/month** |

> 💡 GCP Free Tier: Cloud Run gives 2M requests/month free, 180k vCPU-seconds free.

### AWS (CDK)

| Service | Spec | Monthly Cost (USD) |
|---------|------|--------------------|
| ECS Fargate (container) | 0.25 vCPU, 512MB, always-on | **$9–12** |
| RDS PostgreSQL | db.t4g.micro, 20GB | **$13–18** |
| S3 | 5GB | **$0.12** |
| CloudFront (CDN) | 10GB transfer | **$1–2** |
| Secrets Manager | 10 secrets | **$4** |
| ECR | 5GB container images | **$0.50** |
| **Total** | | **~$28–37/month** |

> 💡 AWS Free Tier (12 months): RDS micro free, 750h EC2/Fargate, CloudFront 1TB.

### Budget Summary

| | GCP (Terraform) | AWS (CDK) |
|--|-----------------|-----------|
| Monthly (no free tier) | ~$26–41 | ~$28–37 |
| Monthly (with free tier) | ~$5–15 | ~$0–15 (first 12 months) |
| Annual estimate | ~$180–490 | ~$180–444 |

**Verdict:** Comparable pricing. AWS free tier is more generous for the first 12 months. GCP Cloud Run's always-free tier is better long-term for low traffic.

---

## 3. Infrastructure Resources Created

### Terraform + GCP

```hcl
# Typical resources for a containerized app
resource "google_cloud_run_v2_service" "api" { }
resource "google_sql_database_instance" "db" { }
resource "google_sql_database" "main" { }
resource "google_sql_user" "app" { }
resource "google_storage_bucket" "assets" { }
resource "google_compute_global_address" "lb" { }
resource "google_compute_url_map" "cdn" { }
resource "google_compute_backend_service" "api" { }
resource "google_compute_ssl_certificate" "cert" { }
resource "google_secret_manager_secret" "db_url" { }
resource "google_artifact_registry_repository" "images" { }
resource "google_vpc_access_connector" "serverless" { }
resource "google_compute_network" "vpc" { }
resource "google_compute_subnetwork" "private" { }
```

**Total: ~14–18 resources**

### AWS CDK

```typescript
// Typical constructs for a containerized app
new ec2.Vpc(this, 'Vpc');
new ecs.Cluster(this, 'Cluster');
new ecs.FargateService(this, 'Service');
new ecs.FargateTaskDefinition(this, 'Task');
new rds.DatabaseInstance(this, 'Database');
new s3.Bucket(this, 'Assets');
new cloudfront.Distribution(this, 'CDN');
new secretsmanager.Secret(this, 'DbSecret');
new ecr.Repository(this, 'Registry');
new elbv2.ApplicationLoadBalancer(this, 'ALB');
new elbv2.ApplicationTargetGroup(this, 'TG');
new certificatemanager.Certificate(this, 'Cert');
```

**Total: ~12–15 high-level constructs → synthesizes to ~40–60 CloudFormation resources**

> CDK L2 constructs auto-create security groups, IAM roles, log groups, subnets, route tables, NAT gateways, etc.

### Comparison

| | Terraform + GCP | AWS CDK |
|--|-----------------|---------|
| Resources you write | 14–18 | 12–15 constructs |
| Actual infra created | 14–18 (what you see is what you get) | 40–60 (abstracted away) |
| Complexity | Explicit, verbose | Abstracted, opinionated |
| Drift detection | Built-in `terraform plan` | CloudFormation drift detection |

**Verdict:** Terraform is more explicit (WYSIWYG). CDK creates more resources under the hood but requires less code.

---

## 4. TypeScript Capability

| Criteria | Terraform (GCP) | AWS CDK |
|----------|-----------------|---------|
| Language | HCL (HashiCorp Config Language) | **TypeScript (native)** ✅ |
| TypeScript support | Via CDKTF (CDK for Terraform) | First-class, built-in |
| Type safety | HCL has basic validation | Full TypeScript type checking |
| IDE support | HCL extension (limited) | Full IntelliSense, autocomplete |
| Loops/Conditions | `for_each`, `count`, `dynamic` blocks | Native TS: `map`, `if`, `for` |
| Testing | `terraform test` (limited) | Jest, full unit testing |
| Code reuse | Modules (HCL) | Classes, functions, npm packages |
| Learning curve | New language (HCL) | Familiar if you know TS |

### CDKTF (Terraform with TypeScript)

```typescript
// CDKTF lets you write Terraform in TypeScript
import { GoogleProvider } from '@cdktf/provider-google';
import { CloudRunV2Service } from '@cdktf/provider-google/lib/cloud-run-v2-service';

new CloudRunV2Service(this, 'api', {
  name: 'performa-api',
  location: 'asia-southeast2',
  template: {
    containers: [{ image: 'gcr.io/my-project/api:latest' }]
  }
});
```

### AWS CDK (Native TypeScript)

```typescript
import * as ecs from 'aws-cdk-lib/aws-ecs';

new ecs.FargateService(this, 'Api', {
  cluster,
  taskDefinition,
  desiredCount: 1,
});
```

**Verdict:** AWS CDK wins on TypeScript experience (native, mature, better types). CDKTF exists but is less polished. If TypeScript is a priority, AWS CDK is superior.

---

## 5. Containerization

| Criteria | Terraform + GCP | AWS CDK |
|----------|-----------------|---------|
| Container Service | **Cloud Run** (serverless) | **ECS Fargate** (serverless) |
| Container Registry | Artifact Registry | ECR (Elastic Container Registry) |
| Scale to Zero | ✅ Yes (Cloud Run) | ❌ No (min 1 task running) |
| Cold Start | ~1–3s | None (always running) |
| Max Instances | Configurable | Configurable |
| Docker Compose compat | Via `docker compose` → Cloud Run | Via `docker compose` → ECS |
| Multi-container pod | ✅ (sidecars in Cloud Run) | ✅ (multiple containers per task) |
| Build pipeline | Cloud Build | CodeBuild / CDK Pipelines |
| Image deploy | `gcloud run deploy --image` | CDK `DockerImageAsset` auto-builds |

### GCP Cloud Run (Terraform)

```hcl
resource "google_cloud_run_v2_service" "api" {
  name     = "performa-api"
  location = "asia-southeast2"
  
  template {
    containers {
      image = "asia-southeast2-docker.pkg.dev/project/repo/api:latest"
      resources {
        limits = { memory = "512Mi", cpu = "1" }
      }
    }
    scaling {
      min_instance_count = 0  # Scale to zero!
      max_instance_count = 10
    }
  }
}
```

### AWS ECS Fargate (CDK)

```typescript
const taskDef = new ecs.FargateTaskDefinition(this, 'Task', {
  memoryLimitMiB: 512,
  cpu: 256,
});

taskDef.addContainer('api', {
  image: ecs.ContainerImage.fromAsset('./apps/api'), // Auto-builds Docker image
  portMappings: [{ containerPort: 3000 }],
});

new ecs.FargateService(this, 'Service', {
  cluster,
  taskDefinition: taskDef,
  desiredCount: 1, // Minimum 1, no scale-to-zero
});
```

**Verdict:** GCP Cloud Run is better for cost-sensitive startups (scale-to-zero). AWS Fargate is better for consistent performance (no cold starts). For 1–100 users with unpredictable traffic, **Cloud Run saves money**.

---

## 6. Security & CDN

### Security

| Criteria | Terraform + GCP | AWS CDK |
|----------|-----------------|---------|
| IAM Model | Google IAM (simple, flat) | AWS IAM (powerful, complex) |
| Secret Management | Secret Manager (simple) | Secrets Manager ($0.40/secret/month) |
| Network Security | VPC, Firewall Rules | VPC, Security Groups, NACLs |
| DDoS Protection | Cloud Armor (free basic) | AWS Shield (free basic) |
| WAF | Cloud Armor WAF ($5/policy) | AWS WAF ($5/WebACL + $1/rule) |
| SSL/TLS | Managed certs (free, auto) | ACM (free, auto) |
| Container Security | Binary Authorization | ECR image scanning |
| Audit Logging | Cloud Audit Logs | CloudTrail |
| Zero Trust | BeyondCorp, IAP | Verified Access |
| Vulnerability Scanning | Container Analysis | Inspector, ECR scanning |

### CDN

| Criteria | Terraform + GCP | AWS CDK |
|----------|-----------------|---------|
| CDN Service | Cloud CDN | CloudFront |
| Edge Locations | 150+ PoPs globally | 450+ PoPs globally |
| Indonesia PoPs | Jakarta, Surabaya | Jakarta |
| Custom Domain + SSL | ✅ Free managed cert | ✅ Free ACM cert |
| WebSocket Support | ✅ | ✅ |
| Edge Functions | Cloud Functions (limited) | Lambda@Edge / CloudFront Functions |
| Cache Invalidation | Instant | ~60s propagation |
| Pricing (10GB/month) | ~$1–2 | ~$1–2 |
| Integration | Requires manual LB setup | Auto-integrated with CDK constructs |

### Security Setup Comparison

**GCP (Terraform):**
```hcl
# Cloud Armor (WAF + DDoS)
resource "google_compute_security_policy" "policy" {
  name = "performa-security"
  
  rule {
    action   = "deny(403)"
    priority = 1000
    match {
      expr { expression = "origin.region_code == 'CN'" }
    }
  }
}

# Managed SSL
resource "google_compute_managed_ssl_certificate" "cert" {
  name = "performa-cert"
  managed { domains = ["api.performa.ai"] }
}
```

**AWS (CDK):**
```typescript
// CloudFront + WAF
const distribution = new cloudfront.Distribution(this, 'CDN', {
  defaultBehavior: { origin: new origins.HttpOrigin('api.performa.ai') },
  certificate: cert,
  webAclId: waf.attrArn,
});

// WAF
const waf = new wafv2.CfnWebACL(this, 'WAF', {
  defaultAction: { allow: {} },
  rules: [{ /* rate limiting, geo blocking */ }],
});
```

**Verdict:** AWS CloudFront has more edge locations globally but GCP has more Indonesia PoPs (Jakarta + Surabaya). Security is comparable; AWS IAM is more granular but more complex. For Indonesia-focused apps, GCP's local presence is slightly better.

---

## Final Recommendation

| Factor | Winner | Why |
|--------|--------|-----|
| Indonesia latency | 🤝 Tie | Both have Jakarta region |
| Budget (1–100 users) | 🏆 GCP | Cloud Run scale-to-zero saves $$ |
| Infrastructure simplicity | 🏆 GCP/Terraform | WYSIWYG, fewer hidden resources |
| TypeScript experience | 🏆 AWS CDK | Native TS, better DX |
| Containerization | 🏆 GCP Cloud Run | Scale-to-zero, cost efficient |
| Security & CDN | 🤝 Tie | Both excellent, GCP better in ID |
| Long-term scaling | 🏆 AWS | More services, larger ecosystem |

### TL;DR

- **Choose GCP + Terraform** if: budget is tight, you want scale-to-zero containers, you prefer explicit IaC, and your users are primarily in Indonesia.
- **Choose AWS + CDK** if: TypeScript DX matters most, you want maximum abstraction, you plan to scale globally, and you're okay paying for always-on containers.
- **Hybrid option:** Use **CDKTF** (Terraform CDK) to get TypeScript + GCP. Best of both worlds, but less mature ecosystem.

### Recommended Stack for Renovix AI (Indonesia, 1–100 users)

```
GCP + Terraform (or CDKTF for TypeScript)
├── Cloud Run (API containers, scale-to-zero)
├── Cloud SQL PostgreSQL (managed DB)
├── Cloud CDN + Load Balancer
├── Secret Manager
├── Artifact Registry (Docker images)
├── Cloud Armor (WAF/DDoS)
└── Estimated: $15–30/month with free tier
```

---

## 7. Frontend (Chat App) Deployment on GCP

The `chat` app is a **Next.js 16** application with SSR/RSC capabilities. Here are the GCP deployment options:

### Option A: Cloud Run (Recommended for SSR/WebSocket)

Best for the chat app because it needs server-side rendering and real-time WebSocket connections.

```hcl
# Cloud Run for Next.js Chat App
resource "google_cloud_run_v2_service" "chat" {
  name     = "performa-chat"
  location = "asia-southeast2"  # Jakarta

  template {
    containers {
      image = "asia-southeast2-docker.pkg.dev/PROJECT/repo/chat:latest"
      
      ports {
        container_port = 3000
      }

      resources {
        limits = {
          memory = "512Mi"
          cpu    = "1"
        }
      }

      env {
        name  = "NEXT_PUBLIC_API_URL"
        value = "https://api.performa.ai"
      }
    }

    scaling {
      min_instance_count = 0   # Scale to zero when no users
      max_instance_count = 5
    }
  }

  traffic {
    percent = 100
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
  }
}

# Public access (no auth required for chat portal)
resource "google_cloud_run_v2_service_iam_member" "chat_public" {
  project  = google_cloud_run_v2_service.chat.project
  location = google_cloud_run_v2_service.chat.location
  name     = google_cloud_run_v2_service.chat.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# Custom domain mapping
resource "google_cloud_run_domain_mapping" "chat" {
  location = "asia-southeast2"
  name     = "chat.performa.ai"

  metadata {
    namespace = "PROJECT_ID"
  }

  spec {
    route_name = google_cloud_run_v2_service.chat.name
  }
}
```

**Dockerfile for Chat App:**

```dockerfile
FROM node:20-alpine AS base

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable pnpm && pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx nx build chat --configuration=production

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/apps/chat/.next/standalone ./
COPY --from=builder /app/apps/chat/.next/static ./.next/static
COPY --from=builder /app/apps/chat/public ./public

USER nextjs
EXPOSE 3000
ENV PORT=3000
CMD ["node", "server.js"]
```

**Cost:** $0–5/month (scale-to-zero with free tier)

---

### Option B: Firebase Hosting (Static + SSR via Cloud Functions)

Good if the chat app can be partially static with API routes handled by Cloud Functions.

```hcl
resource "google_firebase_hosting_site" "chat" {
  provider = google-beta
  project  = "PROJECT_ID"
  site_id  = "performa-chat"
}

resource "google_firebase_hosting_channel" "live" {
  provider = google-beta
  site_id  = google_firebase_hosting_site.chat.site_id
  channel_id = "live"
}
```

**Cost:** Free tier covers 10GB hosting + 360MB/day bandwidth

---

### Option C: Cloud Storage + Cloud CDN (Static Export Only)

Only works if chat app can be fully static (no SSR, no WebSockets).

```hcl
# Static bucket for Next.js export
resource "google_storage_bucket" "chat_static" {
  name     = "performa-chat-static"
  location = "ASIA"

  website {
    main_page_suffix = "index.html"
    not_found_page   = "404.html"
  }
}

# CDN in front of bucket
resource "google_compute_backend_bucket" "chat_cdn" {
  name        = "performa-chat-cdn"
  bucket_name = google_storage_bucket.chat_static.name
  enable_cdn  = true
}
```

**Cost:** ~$0.50/month

---

### Recommendation for Chat App

| Option | SSR | WebSocket | Scale-to-Zero | Cost | Verdict |
|--------|-----|-----------|---------------|------|---------|
| **Cloud Run** | ✅ | ✅ | ✅ | $0–5/mo | **Best for chat** |
| Firebase Hosting | Partial | ❌ | N/A | Free | Good for static |
| Cloud Storage + CDN | ❌ | ❌ | N/A | $0.50 | Only if fully static |

**➡️ Use Cloud Run** for the chat app because:
- Next.js 16 uses React Server Components (needs server)
- Chat likely needs WebSocket/SSE for real-time messaging
- Scale-to-zero keeps cost at $0 when no users are active
- Same deployment pattern as the API (consistency)

---

### Full Architecture (API + Chat on GCP)

```
                    ┌─────────────────────────────────────┐
                    │          Cloud CDN + LB              │
                    │     (Global, Indonesian PoPs)        │
                    └──────────┬──────────┬───────────────┘
                               │          │
                    ┌──────────▼──┐  ┌────▼──────────────┐
                    │  Cloud Run  │  │    Cloud Run       │
                    │  chat app   │  │    API (NestJS)    │
                    │  (Next.js)  │  │                    │
                    │  :3000      │  │    :3333           │
                    └─────────────┘  └────────┬───────────┘
                                              │
                               ┌──────────────▼───────────┐
                               │   Cloud SQL PostgreSQL    │
                               │   (asia-southeast2)       │
                               └───────────────────────────┘

Terraform Resources:
├── google_cloud_run_v2_service.chat        # Next.js chat frontend
├── google_cloud_run_v2_service.api         # NestJS API backend
├── google_sql_database_instance.db         # PostgreSQL
├── google_compute_global_address.lb        # Static IP
├── google_compute_url_map.routing          # Route /chat → chat, /api → api
├── google_compute_backend_service.chat     # Chat backend
├── google_compute_backend_service.api      # API backend
├── google_compute_ssl_certificate.cert     # Managed SSL
├── google_compute_security_policy.waf      # Cloud Armor
├── google_artifact_registry_repository.images  # Docker registry
├── google_secret_manager_secret.secrets    # App secrets
└── google_compute_network.vpc             # Private network

Total: ~18–22 resources
Estimated cost: $20–45/month (1–100 users)
```

---

### CI/CD Pipeline (Cloud Build)

```yaml
# cloudbuild.yaml
steps:
  # Build Chat App
  - name: 'gcr.io/cloud-builders/docker'
    args: ['build', '-t', 'asia-southeast2-docker.pkg.dev/$PROJECT_ID/repo/chat:$COMMIT_SHA', '-f', 'apps/chat/Dockerfile', '.']
  
  # Build API
  - name: 'gcr.io/cloud-builders/docker'
    args: ['build', '-t', 'asia-southeast2-docker.pkg.dev/$PROJECT_ID/repo/api:$COMMIT_SHA', '-f', 'apps/api/Dockerfile', '.']

  # Push images
  - name: 'gcr.io/cloud-builders/docker'
    args: ['push', 'asia-southeast2-docker.pkg.dev/$PROJECT_ID/repo/chat:$COMMIT_SHA']
  - name: 'gcr.io/cloud-builders/docker'
    args: ['push', 'asia-southeast2-docker.pkg.dev/$PROJECT_ID/repo/api:$COMMIT_SHA']

  # Deploy Chat
  - name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
    args: ['gcloud', 'run', 'deploy', 'performa-chat', '--image', 'asia-southeast2-docker.pkg.dev/$PROJECT_ID/repo/chat:$COMMIT_SHA', '--region', 'asia-southeast2']

  # Deploy API
  - name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
    args: ['gcloud', 'run', 'deploy', 'performa-api', '--image', 'asia-southeast2-docker.pkg.dev/$PROJECT_ID/repo/api:$COMMIT_SHA', '--region', 'asia-southeast2']
```

---

*Last updated: May 2026*
