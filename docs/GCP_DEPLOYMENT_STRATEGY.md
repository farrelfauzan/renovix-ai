# GCP Deployment Strategy — Renovix AI

> Full production deployment for all services: API, Chat, Dashboard, Landing  
> Region: `asia-southeast2` (Jakarta, Indonesia)  
> IaC: Terraform  
> Target: 1–100 users, production-ready with security hardening

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Terraform Infrastructure](#2-terraform-infrastructure)
3. [S3 → GCS Migration Strategy](#3-s3--gcs-migration-strategy)
4. [Docker Configs (Production-Ready)](#4-docker-configs-production-ready)
5. [Next.js Configs (Chat, Dashboard, Landing)](#5-nextjs-configs-chat-dashboard-landing)
6. [App-Level Security Hardening](#6-app-level-security-hardening)
7. [CI/CD Pipeline](#7-cicd-pipeline)
8. [Cost Estimate](#8-cost-estimate)
9. [Development Environment Strategy](#9-development-environment-strategy)

---

## 1. Architecture Overview

```
                         Internet
                            │
                    ┌───────▼────────┐
                    │  Cloud CDN +   │  ← SSL termination, caching
                    │  Global LB     │
                    └──┬──┬──┬──┬────┘
                       │  │  │  │
         ┌─────────────┘  │  │  └─────────────┐
         │                │  │                 │
    ┌────▼─────┐  ┌──────▼──▼────┐    ┌──────▼──────┐
    │ Cloud Run│  │  Cloud Run   │    │  Cloud Run  │
    │ Landing  │  │  Chat + Dash │    │    API      │
    │ (Next.js)│  │  (Next.js)   │    │  (NestJS)   │
    │  :3001   │  │  :3000/:4200 │    │   :3000     │
    └──────────┘  └──────────────┘    └──────┬──────┘
                                              │
                       ┌──────────────────────┼──────────────────┐
                       │                      │                  │
              ┌────────▼───────┐    ┌────────▼───────┐  ┌──────▼──────┐
              │  Cloud SQL     │    │  GCS Bucket    │  │   Redis     │
              │  PostgreSQL 16 │    │  (Storage)     │  │  Memorystore│
              │  + pgvector    │    │  + CDN domain  │  │  (optional) │
              └────────────────┘    └────────────────┘  └─────────────┘
                       │
              ┌────────▼───────┐
              │ Secret Manager │
              │ (all secrets)  │
              └────────────────┘
```

### Domain Routing

| Domain | Service | Cloud Run |
|--------|---------|-----------|
| `renovix.id` | Landing page | `renovix-landing` |
| `dashboard.renovix.id` | Dashboard | `renovix-dashboard` |
| `chat.renovix.id` | Chat portal | `renovix-chat` |
| `api.renovix.id` | API | `renovix-api` |
| `cdn.renovix.id` | GCS bucket CDN | Cloud CDN |

---

## 2. Terraform Infrastructure

### Directory Structure

```
infra/
├── main.tf
├── variables.tf
├── outputs.tf
├── terraform.tfvars          # gitignored
├── terraform.tfvars.example
├── versions.tf
├── modules/
│   ├── networking/
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   ├── database/
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   ├── storage/
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   ├── cloud-run/
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   ├── security/
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   └── cdn/
│       ├── main.tf
│       ├── variables.tf
│       └── outputs.tf
└── environments/
    ├── staging.tfvars
    └── production.tfvars
```

### `versions.tf`

```hcl
terraform {
  required_version = ">= 1.7"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.30"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 5.30"
    }
  }

  backend "gcs" {
    bucket = "renovix-ai-terraform-state"
    prefix = "production"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

provider "google-beta" {
  project = var.project_id
  region  = var.region
}
```

### `variables.tf`

```hcl
variable "project_id" {
  description = "GCP Project ID"
  type        = string
}

variable "region" {
  description = "GCP Region"
  type        = string
  default     = "asia-southeast2"
}

variable "environment" {
  description = "Environment (staging/production)"
  type        = string
  default     = "production"
}

variable "domain" {
  description = "Primary domain"
  type        = string
  default     = "renovix.id"
}

variable "db_tier" {
  description = "Cloud SQL instance tier"
  type        = string
  default     = "db-f1-micro" # Upgrade to db-custom-1-3840 when needed
}

variable "db_password" {
  description = "Database password"
  type        = string
  sensitive   = true
}

variable "jwt_secret" {
  description = "JWT signing secret"
  type        = string
  sensitive   = true
}
```

### `main.tf`

```hcl
# ─── Networking ───
module "networking" {
  source     = "./modules/networking"
  project_id = var.project_id
  region     = var.region
}

# ─── Database ───
module "database" {
  source         = "./modules/database"
  project_id     = var.project_id
  region         = var.region
  network_id     = module.networking.vpc_id
  db_tier        = var.db_tier
  db_password    = var.db_password
}

# ─── Storage (GCS) ───
module "storage" {
  source     = "./modules/storage"
  project_id = var.project_id
  region     = var.region
  domain     = var.domain
}

# ─── Secrets ───
module "security" {
  source      = "./modules/security"
  project_id  = var.project_id
  region      = var.region
  db_url      = module.database.connection_url
  jwt_secret  = var.jwt_secret
}

# ─── Cloud Run Services ───
module "cloud_run" {
  source              = "./modules/cloud-run"
  project_id          = var.project_id
  region              = var.region
  vpc_connector_id    = module.networking.vpc_connector_id
  db_connection_name  = module.database.connection_name
  secrets             = module.security.secret_ids
}

# ─── CDN + Load Balancer ───
module "cdn" {
  source     = "./modules/cdn"
  project_id = var.project_id
  domain     = var.domain
  cloud_run  = module.cloud_run.services
  storage    = module.storage.bucket_backend
  security_policy = module.security.armor_policy_id
}
```

### `modules/networking/main.tf`

```hcl
resource "google_compute_network" "vpc" {
  name                    = "renovix-vpc"
  auto_create_subnetworks = false
  project                 = var.project_id
}

resource "google_compute_subnetwork" "private" {
  name          = "renovix-private"
  ip_cidr_range = "10.0.0.0/24"
  region        = var.region
  network       = google_compute_network.vpc.id

  private_ip_google_access = true
}

# Serverless VPC Connector (Cloud Run → Cloud SQL)
resource "google_vpc_access_connector" "connector" {
  name          = "renovix-connector"
  region        = var.region
  network       = google_compute_network.vpc.name
  ip_cidr_range = "10.8.0.0/28"
  machine_type  = "e2-micro"
  min_instances = 2
  max_instances = 3
}

# Private Services Access (Cloud SQL private IP)
resource "google_compute_global_address" "private_ip_range" {
  name          = "renovix-private-ip"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = google_compute_network.vpc.id
}

resource "google_service_networking_connection" "private_vpc" {
  network                 = google_compute_network.vpc.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_ip_range.name]
}

output "vpc_id" {
  value = google_compute_network.vpc.id
}

output "vpc_connector_id" {
  value = google_vpc_access_connector.connector.id
}
```

### `modules/database/main.tf`

```hcl
resource "google_sql_database_instance" "main" {
  name             = "renovix-db-${var.region}"
  database_version = "POSTGRES_16"
  region           = var.region

  settings {
    tier              = var.db_tier
    availability_type = "ZONAL" # Use REGIONAL for HA when scaling
    disk_size         = 10
    disk_type         = "PD_SSD"
    disk_autoresize   = true

    ip_configuration {
      ipv4_enabled    = false
      private_network = var.network_id

      # No public IP — only accessible via VPC
    }

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      start_time                     = "03:00" # 10:00 WIB (off-peak)
      transaction_log_retention_days = 7

      backup_retention_settings {
        retained_backups = 14
      }
    }

    maintenance_window {
      day          = 7 # Sunday
      hour         = 3 # 10:00 WIB
      update_track = "stable"
    }

    database_flags {
      name  = "max_connections"
      value = "100"
    }

    # Enable pgvector extension
    database_flags {
      name  = "cloudsql.enable_pg_vector"
      value = "on"
    }

    insights_config {
      query_insights_enabled  = true
      record_application_tags = true
      record_client_address   = true
    }
  }

  deletion_protection = true

  depends_on = [google_service_networking_connection.private_vpc]
}

resource "google_sql_database" "main" {
  name     = "renovix_ai"
  instance = google_sql_database_instance.main.name
}

resource "google_sql_user" "app" {
  name     = "renovix_app"
  instance = google_sql_database_instance.main.name
  password = var.db_password
}

output "connection_name" {
  value = google_sql_database_instance.main.connection_name
}

output "connection_url" {
  value     = "postgresql://renovix_app:${var.db_password}@/renovix_ai?host=/cloudsql/${google_sql_database_instance.main.connection_name}"
  sensitive = true
}
```

### `modules/storage/main.tf`

```hcl
resource "google_storage_bucket" "main" {
  name     = "renovix-ai-storage-${var.project_id}"
  location = "ASIA"

  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  versioning {
    enabled = true
  }

  lifecycle_rule {
    action {
      type = "Delete"
    }
    condition {
      num_newer_versions = 3
    }
  }

  lifecycle_rule {
    action {
      type          = "SetStorageClass"
      storage_class = "NEARLINE"
    }
    condition {
      age = 90 # Move to Nearline after 90 days
    }
  }

  cors {
    origin          = ["https://*.renovix.id"]
    method          = ["GET", "PUT"]
    response_header = ["Content-Type", "Content-Disposition"]
    max_age_seconds = 3600
  }

  encryption {
    default_kms_key_name = google_kms_crypto_key.storage_key.id
  }
}

# Customer-managed encryption key
resource "google_kms_key_ring" "storage" {
  name     = "renovix-storage-keyring"
  location = var.region
}

resource "google_kms_crypto_key" "storage_key" {
  name     = "renovix-storage-key"
  key_ring = google_kms_key_ring.storage.id

  rotation_period = "7776000s" # 90 days
}

# Service account for Cloud Run → GCS access
resource "google_service_account" "storage_access" {
  account_id   = "renovix-storage-sa"
  display_name = "Renovix Storage Service Account"
}

resource "google_storage_bucket_iam_member" "storage_admin" {
  bucket = google_storage_bucket.main.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.storage_access.email}"
}

# CDN backend bucket
resource "google_compute_backend_bucket" "cdn" {
  name        = "renovix-cdn-bucket"
  bucket_name = google_storage_bucket.main.name
  enable_cdn  = true

  cdn_policy {
    cache_mode        = "CACHE_ALL_STATIC"
    default_ttl       = 3600
    max_ttl           = 86400
    signed_url_cache_max_age_sec = 7200
  }
}

output "bucket_name" {
  value = google_storage_bucket.main.name
}

output "bucket_backend" {
  value = google_compute_backend_bucket.cdn.self_link
}
```

### `modules/cloud-run/main.tf`

```hcl
# ─── API Service ───
resource "google_cloud_run_v2_service" "api" {
  name     = "renovix-api"
  location = var.region

  template {
    service_account = google_service_account.api.email

    vpc_access {
      connector = var.vpc_connector_id
      egress    = "PRIVATE_RANGES_ONLY"
    }

    containers {
      image = "asia-southeast2-docker.pkg.dev/${var.project_id}/renovix/api:latest"

      ports {
        container_port = 3000
      }

      resources {
        limits = {
          memory = "1Gi"
          cpu    = "1"
        }
        cpu_idle = true # Allow CPU throttling when idle (cost savings)
      }

      # Secrets mounted from Secret Manager
      dynamic "env" {
        for_each = var.secrets
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = env.value
              version = "latest"
            }
          }
        }
      }

      env {
        name  = "NODE_ENV"
        value = "production"
      }

      env {
        name  = "GCS_BUCKET"
        value = var.bucket_name
      }

      startup_probe {
        http_get {
          path = "/api/health"
        }
        initial_delay_seconds = 5
        period_seconds        = 3
        failure_threshold     = 10
      }

      liveness_probe {
        http_get {
          path = "/api/health"
        }
        period_seconds    = 30
        failure_threshold = 3
      }
    }

    scaling {
      min_instance_count = 0
      max_instance_count = 10
    }

    max_instance_request_concurrency = 80
    timeout                          = "300s"
  }

  traffic {
    percent = 100
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
  }
}

# ─── Chat Service ───
resource "google_cloud_run_v2_service" "chat" {
  name     = "renovix-chat"
  location = var.region

  template {
    service_account = google_service_account.frontend.email

    containers {
      image = "asia-southeast2-docker.pkg.dev/${var.project_id}/renovix/chat:latest"

      ports {
        container_port = 3000
      }

      resources {
        limits = {
          memory = "512Mi"
          cpu    = "1"
        }
        cpu_idle = true
      }

      env {
        name  = "NEXT_PUBLIC_API_URL"
        value = "https://api.renovix.id"
      }

      env {
        name  = "NODE_ENV"
        value = "production"
      }
    }

    scaling {
      min_instance_count = 0
      max_instance_count = 5
    }

    max_instance_request_concurrency = 100
    timeout                          = "60s"
  }

  traffic {
    percent = 100
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
  }
}

# ─── Dashboard Service ───
resource "google_cloud_run_v2_service" "dashboard" {
  name     = "renovix-dashboard"
  location = var.region

  template {
    service_account = google_service_account.frontend.email

    containers {
      image = "asia-southeast2-docker.pkg.dev/${var.project_id}/renovix/dashboard:latest"

      ports {
        container_port = 4200
      }

      resources {
        limits = {
          memory = "512Mi"
          cpu    = "1"
        }
        cpu_idle = true
      }

      env {
        name  = "NEXT_PUBLIC_API_URL"
        value = "https://api.renovix.id"
      }

      env {
        name  = "NODE_ENV"
        value = "production"
      }
    }

    scaling {
      min_instance_count = 0
      max_instance_count = 5
    }

    max_instance_request_concurrency = 100
    timeout                          = "60s"
  }

  traffic {
    percent = 100
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
  }
}

# ─── Landing Service ───
resource "google_cloud_run_v2_service" "landing" {
  name     = "renovix-landing"
  location = var.region

  template {
    service_account = google_service_account.frontend.email

    containers {
      image = "asia-southeast2-docker.pkg.dev/${var.project_id}/renovix/landing:latest"

      ports {
        container_port = 3001
      }

      resources {
        limits = {
          memory = "256Mi"
          cpu    = "1"
        }
        cpu_idle = true
      }

      env {
        name  = "NODE_ENV"
        value = "production"
      }
    }

    scaling {
      min_instance_count = 0
      max_instance_count = 3
    }

    max_instance_request_concurrency = 200
    timeout                          = "30s"
  }

  traffic {
    percent = 100
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
  }
}

# ─── Service Accounts (Least Privilege) ───
resource "google_service_account" "api" {
  account_id   = "renovix-api-sa"
  display_name = "Renovix API Service Account"
}

resource "google_service_account" "frontend" {
  account_id   = "renovix-frontend-sa"
  display_name = "Renovix Frontend Service Account"
}

# API SA Permissions
resource "google_project_iam_member" "api_sql" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.api.email}"
}

resource "google_project_iam_member" "api_secrets" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.api.email}"
}

resource "google_project_iam_member" "api_storage" {
  project = var.project_id
  role    = "roles/storage.objectAdmin"
  member  = "serviceAccount:${google_service_account.api.email}"
}

# ─── Public Access (Chat + Landing = public, Dashboard = authenticated via app) ───
resource "google_cloud_run_v2_service_iam_member" "chat_public" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.chat.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_service_iam_member" "landing_public" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.landing.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_service_iam_member" "dashboard_public" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.dashboard.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_service_iam_member" "api_public" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.api.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ─── Artifact Registry ───
resource "google_artifact_registry_repository" "images" {
  location      = var.region
  repository_id = "renovix"
  format        = "DOCKER"

  cleanup_policies {
    id     = "keep-last-5"
    action = "KEEP"
    most_recent_versions {
      keep_count = 5
    }
  }
}

output "services" {
  value = {
    api       = google_cloud_run_v2_service.api.uri
    chat      = google_cloud_run_v2_service.chat.uri
    dashboard = google_cloud_run_v2_service.dashboard.uri
    landing   = google_cloud_run_v2_service.landing.uri
  }
}
```

### `modules/security/main.tf`

```hcl
# ─── Secret Manager ───
locals {
  # Secrets with values that Terraform knows (auto-populated)
  auto_secrets = {
    DATABASE_URL       = var.db_url
    JWT_SECRET         = var.jwt_secret
    BETTER_AUTH_SECRET = var.better_auth_secret
  }

  # Secrets that Terraform creates but YOU set manually after deploy
  # (never store real API keys in Terraform state or git)
  manual_secrets = [
    "TOGETHER_API_KEY",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GITHUB_CLIENT_ID",
    "GITHUB_CLIENT_SECRET",
  ]

  all_secret_keys = concat(keys(local.auto_secrets), local.manual_secrets)
}

# Create all secret entries in Secret Manager
resource "google_secret_manager_secret" "secrets" {
  for_each  = toset(local.all_secret_keys)
  secret_id = lower(replace(each.key, "_", "-"))

  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }
}

# Only auto-populate the ones Terraform knows
resource "google_secret_manager_secret_version" "auto" {
  for_each    = local.auto_secrets
  secret      = google_secret_manager_secret.secrets[each.key].id
  secret_data = each.value
}

# ┌─────────────────────────────────────────────────────────────────┐
# │  AFTER `terraform apply`, set the manual secrets via gcloud:    │
# │                                                                 │
# │  gcloud secrets versions add together-api-key \                 │
# │    --data-file=- <<< "your-together-api-key-here"               │
# │                                                                 │
# │  gcloud secrets versions add stripe-secret-key \                │
# │    --data-file=- <<< "sk_live_xxx"                              │
# │                                                                 │
# │  gcloud secrets versions add stripe-webhook-secret \            │
# │    --data-file=- <<< "whsec_xxx"                                │
# │                                                                 │
# │  gcloud secrets versions add s3-access-key-id \                 │
# │    --data-file=- <<< "GOOG1E..."                                │
# │                                                                 │
# │  gcloud secrets versions add s3-secret-access-key \             │
# │    --data-file=- <<< "abc123..."                                │
# └─────────────────────────────────────────────────────────────────┘

# ─── Cloud Armor (WAF + DDoS) ───
resource "google_compute_security_policy" "main" {
  name = "renovix-security-policy"

  # Default: allow all
  rule {
    action   = "allow"
    priority = 2147483647
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
  }

  # Block known bad actors / botnets
  rule {
    action   = "deny(403)"
    priority = 1000
    match {
      expr {
        expression = "evaluatePreconfiguredExpr('xss-v33-stable')"
      }
    }
    description = "Block XSS attacks"
  }

  rule {
    action   = "deny(403)"
    priority = 1001
    match {
      expr {
        expression = "evaluatePreconfiguredExpr('sqli-v33-stable')"
      }
    }
    description = "Block SQL injection"
  }

  rule {
    action   = "deny(403)"
    priority = 1002
    match {
      expr {
        expression = "evaluatePreconfiguredExpr('lfi-v33-stable')"
      }
    }
    description = "Block local file inclusion"
  }

  rule {
    action   = "deny(403)"
    priority = 1003
    match {
      expr {
        expression = "evaluatePreconfiguredExpr('rfi-v33-stable')"
      }
    }
    description = "Block remote file inclusion"
  }

  # Rate limiting: 100 req/min per IP
  rule {
    action   = "throttle"
    priority = 2000
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
    rate_limit_options {
      conform_action = "allow"
      exceed_action  = "deny(429)"
      rate_limit_threshold {
        count        = 100
        interval_sec = 60
      }
    }
    description = "Rate limit: 100 req/min per IP"
  }

  # Stricter rate limit on auth endpoints
  rule {
    action   = "throttle"
    priority = 1500
    match {
      expr {
        expression = "request.path.matches('/api/v1/auth/.*')"
      }
    }
    rate_limit_options {
      conform_action = "allow"
      exceed_action  = "deny(429)"
      rate_limit_threshold {
        count        = 10
        interval_sec = 60
      }
    }
    description = "Rate limit auth: 10 req/min per IP"
  }
}

output "armor_policy_id" {
  value = google_compute_security_policy.main.id
}

output "secret_ids" {
  value = { for k, v in google_secret_manager_secret.secrets : k => v.secret_id }
}
```

---

## 3. S3 → GCS Migration Strategy

### Current State

Your `S3Service` uses `@aws-sdk/client-s3` with these env vars:
- `S3_BUCKET`
- `S3_REGION`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`
- `S3_ENDPOINT` (MinIO in dev)
- `S3_CDN_DOMAIN`

### Migration Approach: GCS with S3-Compatible API (Zero Code Change)

GCS provides an **S3-compatible XML API** — your existing `@aws-sdk/client-s3` code works with GCS by changing only env vars:

```env
# Before (AWS S3 / MinIO)
S3_BUCKET=renovix-ai
S3_REGION=ap-southeast-1
S3_ACCESS_KEY_ID=AKIA...
S3_SECRET_ACCESS_KEY=secret...
S3_ENDPOINT=                          # empty for real S3
S3_CDN_DOMAIN=cdn.renovix.id

# After (GCS via S3-compatible API)
S3_BUCKET=renovix-ai-storage-PROJECT_ID
S3_REGION=asia-southeast2
S3_ACCESS_KEY_ID=GOOG...              # GCS HMAC key
S3_SECRET_ACCESS_KEY=secret...        # GCS HMAC secret
S3_ENDPOINT=https://storage.googleapis.com
S3_CDN_DOMAIN=cdn.renovix.id
```

### Generate HMAC Keys for GCS

```bash
# Create HMAC key for the service account
gcloud storage hmac create renovix-api-sa@PROJECT_ID.iam.gserviceaccount.com

# Output:
# accessId: GOOG1E...
# secret: abc123...
```

### Terraform for HMAC Key

```hcl
resource "google_storage_hmac_key" "api_key" {
  service_account_email = google_service_account.api.email
}

# Store in Secret Manager
resource "google_secret_manager_secret_version" "s3_access_key" {
  secret      = google_secret_manager_secret.secrets["S3_ACCESS_KEY_ID"].id
  secret_data = google_storage_hmac_key.api_key.access_id
}

resource "google_secret_manager_secret_version" "s3_secret_key" {
  secret      = google_secret_manager_secret.secrets["S3_SECRET_ACCESS_KEY"].id
  secret_data = google_storage_hmac_key.api_key.secret
}
```

### Data Migration (Existing S3 → GCS)

```bash
# Option 1: Google Transfer Service (recommended for large data)
gcloud transfer jobs create \
  s3://renovix-ai \
  gs://renovix-ai-storage-PROJECT_ID \
  --source-creds-file=aws-creds.json \
  --name=s3-to-gcs-migration

# Option 2: gsutil for small datasets (<10GB)
gsutil -m rsync -r s3://renovix-ai gs://renovix-ai-storage-PROJECT_ID
```

### Migration Steps

| Step | Action | Downtime |
|------|--------|----------|
| 1 | Create GCS bucket + HMAC keys via Terraform | None |
| 2 | Copy all existing S3 data → GCS | None (background) |
| 3 | Verify data integrity (checksums) | None |
| 4 | Update env vars in Secret Manager | None |
| 5 | Deploy new Cloud Run revision | ~30s (rolling) |
| 6 | Verify uploads/downloads work | None |
| 7 | Decommission old S3 bucket (after 7 days) | None |

**Total downtime: ~30 seconds** (during rolling deployment)

### Future: Native GCS Client (Optional)

If you later want to use native GCS features (signed URLs with IAM, resumable uploads, event notifications), replace `S3Service`:

```typescript
// storage.service.ts — native GCS version
import { Storage } from "@google-cloud/storage";

@Injectable()
export class StorageService {
  private readonly storage: Storage;
  private readonly bucket: string;

  constructor(private readonly config: ConfigService) {
    this.bucket = config.getOrThrow("GCS_BUCKET");
    this.storage = new Storage(); // Auto-uses service account in Cloud Run
  }

  async upload(key: string, body: Buffer, contentType: string): Promise<string> {
    const file = this.storage.bucket(this.bucket).file(key);
    await file.save(body, { contentType, resumable: false });
    return key;
  }

  async download(key: string): Promise<Buffer> {
    const [content] = await this.storage.bucket(this.bucket).file(key).download();
    return content;
  }

  async getSignedUrl(key: string, filename: string, expiresIn = 3600): Promise<string> {
    const [url] = await this.storage.bucket(this.bucket).file(key).getSignedUrl({
      action: "read",
      expires: Date.now() + expiresIn * 1000,
      responseDisposition: `attachment; filename="${filename}"`,
    });
    return url;
  }

  async delete(key: string): Promise<void> {
    await this.storage.bucket(this.bucket).file(key).delete();
  }
}
```

---

## 4. Docker Configs (Production-Ready)

### `apps/api/Dockerfile` (Hardened)

```dockerfile
# Build context: monorepo root
# Usage: docker build -f apps/api/Dockerfile .

# ─── Stage 1: Install dependencies ───
FROM node:22-alpine AS deps
WORKDIR /app

# Security: Don't run as root for installs
RUN apk add --no-cache dumb-init

COPY package.json ./
COPY apps/api/package.json ./apps/api/
COPY prisma/schema.prisma ./prisma/schema.prisma
COPY prisma.config.ts ./prisma.config.ts

RUN npm install --ignore-scripts

# ─── Stage 2: Generate Prisma client ───
FROM deps AS prisma
COPY prisma/ ./prisma/
RUN DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" npx prisma generate

# ─── Stage 3: Build ───
FROM prisma AS builder
COPY . .
COPY --from=prisma /app/node_modules ./node_modules
COPY --from=prisma /app/apps/api/src/generated ./apps/api/src/generated

RUN cd apps/api && npx webpack-cli build --config webpack.docker.config.js

# ─── Stage 4: Production (Hardened) ───
FROM node:22-alpine

# Security: Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

WORKDIR /app
ENV NODE_ENV=production

# Security: Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --ingroup nodejs appuser

COPY --from=builder --chown=appuser:nodejs /app/apps/api/dist ./dist
COPY --from=prisma --chown=appuser:nodejs /app/node_modules ./node_modules
COPY --from=prisma --chown=appuser:nodejs /app/prisma ./prisma
COPY --from=prisma --chown=appuser:nodejs /app/prisma.config.ts ./prisma.config.ts
COPY --from=prisma --chown=appuser:nodejs /app/package.json ./package.json

# Security: No root, no shell access in production
USER appuser

# Security: Read-only filesystem (Cloud Run supports this)
# Healthcheck for Cloud Run probes
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

EXPOSE 3000

# Use dumb-init to handle PID 1 and signals properly
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
```

### `apps/chat/Dockerfile` (New — Production-Ready)

```dockerfile
# Build context: monorepo root
# Usage: docker build -f apps/chat/Dockerfile .

# ─── Stage 1: Install dependencies ───
FROM node:22-alpine AS deps
WORKDIR /app

COPY package.json ./
COPY apps/chat/package.json ./apps/chat/

RUN npm install --ignore-scripts

# ─── Stage 2: Build ───
FROM deps AS builder
WORKDIR /app

COPY . .
COPY --from=deps /app/node_modules ./node_modules

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# Build args for public env vars (baked at build time)
ARG NEXT_PUBLIC_API_URL=https://api.renovix.id
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

RUN cd apps/chat && npx next build

# ─── Stage 3: Production (Hardened) ───
FROM node:22-alpine

RUN apk add --no-cache dumb-init

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --ingroup nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/apps/chat/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/chat/.next/static ./apps/chat/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/chat/public ./apps/chat/public

USER nextjs

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/ || exit 1

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "apps/chat/server.js"]
```

### `apps/dashboard/Dockerfile` (Hardened)

```dockerfile
# Build context: monorepo root
# Usage: docker build -f apps/dashboard/Dockerfile .

FROM node:22-alpine AS deps
WORKDIR /app

COPY package.json ./
COPY apps/dashboard/package.json ./apps/dashboard/
COPY prisma/schema.prisma ./prisma/schema.prisma
COPY prisma.config.ts ./prisma.config.ts

RUN npm install --ignore-scripts

FROM deps AS builder
WORKDIR /app

COPY . .
COPY --from=deps /app/node_modules ./node_modules

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

ARG NEXT_PUBLIC_API_URL=https://api.renovix.id
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

RUN cd apps/dashboard && npx next build

FROM node:22-alpine

RUN apk add --no-cache dumb-init

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --ingroup nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/apps/dashboard/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/dashboard/.next/static ./apps/dashboard/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/dashboard/public ./apps/dashboard/public

USER nextjs

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4200/ || exit 1

EXPOSE 4200
ENV PORT=4200
ENV HOSTNAME="0.0.0.0"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "apps/dashboard/server.js"]
```

### `.dockerignore` (Root)

```
node_modules
.git
.gitignore
*.md
.env*
.next
dist
coverage
.nx
tmp
```

---

## 5. Next.js Configs (Chat, Dashboard, Landing)

### `apps/chat/next.config.js` (Production-Ready)

```js
//@ts-check
const { composePlugins, withNx } = require('@nx/next');

/** @type {import('@nx/next/plugins/with-nx').WithNxOptions} */
const nextConfig = {
  nx: {},

  // Required for Docker standalone output
  output: 'standalone',

  // Security headers
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // Next.js requires unsafe-inline
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https://cdn.renovix.id",
              "font-src 'self'",
              "connect-src 'self' https://api.renovix.id wss://api.renovix.id",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join('; '),
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains; preload',
          },
        ],
      },
    ];
  },

  // Image optimization
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'cdn.renovix.id',
      },
    ],
  },

  // Disable x-powered-by header
  poweredByHeader: false,

  // Compress responses
  compress: true,

  // React strict mode
  reactStrictMode: true,
};

const plugins = [withNx];

module.exports = composePlugins(...plugins)(nextConfig);
```

### `apps/dashboard/next.config.js` (Production-Ready)

```js
//@ts-check
const { composePlugins, withNx } = require('@nx/next');

/** @type {import('@nx/next/plugins/with-nx').WithNxOptions} */
const nextConfig = {
  nx: {},
  output: 'standalone',

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https://cdn.renovix.id",
              "font-src 'self'",
              "connect-src 'self' https://api.renovix.id wss://api.renovix.id",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join('; '),
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains; preload',
          },
        ],
      },
    ];
  },

  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'cdn.renovix.id',
      },
    ],
  },

  poweredByHeader: false,
  compress: true,
  reactStrictMode: true,
};

const plugins = [withNx];
module.exports = composePlugins(...plugins)(nextConfig);
```

---

## 6. App-Level Security Hardening

### Current Security Posture

| Feature | Status | Notes |
|---------|--------|-------|
| Helmet (security headers) | ✅ Done | `@fastify/helmet` in main.ts |
| Rate limiting (global) | ✅ Done | ThrottlerModule: 60 req/min |
| Rate limiting (per endpoint) | ✅ Done | `@Throttle` on sensitive endpoints |
| CORS (dev only) | ✅ Done | Disabled in production |
| File upload limit | ✅ Done | 10MB max |
| Input sanitization (partial) | ⚠️ Partial | Only in calculator tool |
| JWT auth | ✅ Done | — |
| Body size limit | ✅ Done | 1MB production |

### Improvements to Implement

### 6.1 Production CORS Configuration

```typescript
// main.ts — replace the cors config
const allowedOrigins = [
  'https://dashboard.renovix.id',
  'https://chat.renovix.id',
  'https://renovix.id',
];

const app = await NestFactory.create<NestFastifyApplication>(
  AppModule,
  new FastifyAdapter({
    bodyLimit: 1024 * 1024, // 1MB
    trustProxy: true,       // Behind Cloud Run proxy
  }),
  {
    cors: {
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'));
        }
      },
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Portal-Session'],
      credentials: true,
      maxAge: 86400,
    },
    logger: ['error', 'warn'],
    rawBody: true,
  },
);
```

### 6.2 Request Validation & Sanitization

```bash
npm install class-validator class-transformer sanitize-html
```

```typescript
// main.ts — add global validation pipe
import { ValidationPipe } from '@nestjs/common';

app.useGlobalPipes(
  new ValidationPipe({
    whitelist: true,           // Strip unknown properties
    forbidNonWhitelisted: true, // Throw on unknown properties
    transform: true,            // Auto-transform types
    transformOptions: {
      enableImplicitConversion: false,
    },
  }),
);
```

### 6.3 Security Middleware Stack

```typescript
// app/common/security.middleware.ts
import { Injectable, NestMiddleware } from '@nestjs/common';
import { FastifyRequest, FastifyReply } from 'fastify';

@Injectable()
export class SecurityMiddleware implements NestMiddleware {
  use(req: FastifyRequest, res: FastifyReply, next: () => void) {
    // Block requests with suspicious patterns
    const suspiciousPatterns = [
      /\.\.\//,           // Path traversal
      /<script/i,         // XSS in URL
      /javascript:/i,     // XSS protocol
      /on\w+\s*=/i,       // Event handler injection
    ];

    const url = req.url;
    for (const pattern of suspiciousPatterns) {
      if (pattern.test(url)) {
        res.status(400).send({ message: 'Bad request' });
        return;
      }
    }

    next();
  }
}
```

### 6.4 API Key Rotation & Expiry

```typescript
// auth/guards/api-key-expiry.guard.ts
@Injectable()
export class ApiKeyExpiryGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const apiKey = request.headers['x-api-key'];

    if (!apiKey) return true; // Let other guards handle

    const key = await this.prisma.apiKey.findUnique({
      where: { key: apiKey },
      select: { expiresAt: true, revokedAt: true, lastUsedAt: true },
    });

    if (!key) return false;
    if (key.revokedAt) return false;
    if (key.expiresAt && key.expiresAt < new Date()) return false;

    // Update last used (fire and forget)
    this.prisma.apiKey.update({
      where: { key: apiKey },
      data: { lastUsedAt: new Date() },
    }).catch(() => {});

    return true;
  }
}
```

### 6.5 Audit Logging

```typescript
// common/interceptors/audit-log.interceptor.ts
@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger('AuditLog');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const method = request.method;
    const url = request.url;
    const userId = request.user?.id || 'anonymous';
    const ip = request.ip;
    const startTime = Date.now();

    return next.handle().pipe(
      tap(() => {
        const duration = Date.now() - startTime;
        if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
          this.logger.log(
            JSON.stringify({
              action: `${method} ${url}`,
              userId,
              ip,
              duration,
              timestamp: new Date().toISOString(),
            }),
          );
        }
      }),
    );
  }
}
```

### 6.6 File Upload Hardening

```typescript
// common/guards/file-upload.guard.ts
const ALLOWED_MIME_TYPES = [
  'text/markdown',
  'text/plain',
  'application/pdf',
  'application/json',
];

const MAGIC_BYTES: Record<string, Buffer> = {
  'application/pdf': Buffer.from([0x25, 0x50, 0x44, 0x46]),
};

@Injectable()
export class FileUploadGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const file = request.file;

    if (!file) return true;

    // Validate MIME type
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException(`File type ${file.mimetype} not allowed`);
    }

    // Validate file extension matches MIME
    const ext = file.originalname.split('.').pop()?.toLowerCase();
    const mimeToExt: Record<string, string[]> = {
      'text/markdown': ['md', 'markdown'],
      'text/plain': ['txt'],
      'application/pdf': ['pdf'],
      'application/json': ['json'],
    };

    if (!mimeToExt[file.mimetype]?.includes(ext || '')) {
      throw new BadRequestException('File extension does not match content type');
    }

    // Validate magic bytes for binary files
    const expectedMagic = MAGIC_BYTES[file.mimetype];
    if (expectedMagic && !file.buffer.subarray(0, expectedMagic.length).equals(expectedMagic)) {
      throw new BadRequestException('File content does not match declared type');
    }

    // Sanitize filename (prevent path traversal)
    file.originalname = file.originalname
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/\.{2,}/g, '.');

    return true;
  }
}
```

### 6.7 Environment-Based Security Config

```typescript
// config/security.config.ts
import { registerAs } from '@nestjs/config';

export default registerAs('security', () => ({
  cors: {
    origins: (process.env.CORS_ORIGINS || '').split(',').filter(Boolean),
  },
  rateLimit: {
    global: {
      ttl: parseInt(process.env.RATE_LIMIT_TTL || '60000'),
      limit: parseInt(process.env.RATE_LIMIT_MAX || '60'),
    },
    auth: {
      ttl: 60000,
      limit: parseInt(process.env.AUTH_RATE_LIMIT || '5'),
    },
  },
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  },
  upload: {
    maxSize: parseInt(process.env.MAX_UPLOAD_SIZE || String(10 * 1024 * 1024)),
    allowedTypes: ['text/markdown', 'text/plain', 'application/pdf'],
  },
}));
```

### 6.8 Security Headers (Enhanced Helmet Config)

```typescript
// main.ts — enhanced helmet
await fastifyInstance.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https://cdn.renovix.id"],
      connectSrc: ["'self'", "https://api.renovix.id"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'none'"],
      frameSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: true,
  crossOriginOpenerPolicy: true,
  crossOriginResourcePolicy: { policy: 'same-site' },
  dnsPrefetchControl: true,
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  ieNoOpen: true,
  noSniff: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  xssFilter: true,
});
```

### 6.9 JWT Hardening

```typescript
// auth/auth.module.ts — enhanced JWT config
JwtModule.registerAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    secret: config.getOrThrow('JWT_SECRET'),
    signOptions: {
      expiresIn: '7d',
      issuer: 'renovix.id',
      audience: 'renovix-api',
      algorithm: 'HS256',
    },
    verifyOptions: {
      issuer: 'renovix.id',
      audience: 'renovix-api',
      algorithms: ['HS256'],
      clockTolerance: 30, // 30 second tolerance
    },
  }),
}),
```

### 6.10 Dependency Security

```json
// package.json — add security scripts
{
  "scripts": {
    "security:audit": "npm audit --production",
    "security:check": "npx better-npm-audit audit --production --level moderate",
    "security:outdated": "npm outdated",
    "security:licenses": "npx license-checker --production --failOn 'GPL-3.0'"
  }
}
```

### Security Summary

| Layer | Protection | Implementation |
|-------|-----------|----------------|
| **Network** | DDoS, Geo-blocking | Cloud Armor |
| **Transport** | TLS 1.3, HSTS | Managed SSL + Cloud CDN |
| **WAF** | XSS, SQLi, LFI, RFI | Cloud Armor preconfigured rules |
| **Rate Limiting** | Per IP + per endpoint | Cloud Armor + NestJS Throttler |
| **Auth** | JWT with issuer/audience | NestJS JWT module |
| **CORS** | Strict origin whitelist | Fastify CORS |
| **Headers** | CSP, HSTS, X-Frame | Helmet + Next.js headers |
| **Input** | Validation, sanitization | class-validator + whitelist |
| **Uploads** | Type check, magic bytes | Custom guard |
| **Secrets** | Managed, rotated | GCP Secret Manager |
| **Containers** | Non-root, read-only | Dockerfile hardening |
| **Database** | Private IP only, encrypted | VPC + Cloud SQL |
| **Storage** | Encrypted (CMEK), no public | GCS + KMS |
| **Audit** | All mutations logged | Custom interceptor |
| **Dependencies** | Auto-audit | npm audit + CI check |

---

## 7. CI/CD Pipeline

### `cloudbuild.yaml`

```yaml
steps:
  # ─── Security: Scan for vulnerabilities ───
  - name: 'node:22-alpine'
    entrypoint: 'sh'
    args:
      - '-c'
      - 'npm audit --production --audit-level=high || true'
    id: 'security-audit'

  # ─── Build API ───
  - name: 'gcr.io/cloud-builders/docker'
    args:
      - 'build'
      - '--cache-from'
      - 'asia-southeast2-docker.pkg.dev/$PROJECT_ID/renovix/api:latest'
      - '-t'
      - 'asia-southeast2-docker.pkg.dev/$PROJECT_ID/renovix/api:$COMMIT_SHA'
      - '-t'
      - 'asia-southeast2-docker.pkg.dev/$PROJECT_ID/renovix/api:latest'
      - '-f'
      - 'apps/api/Dockerfile'
      - '.'
    id: 'build-api'

  # ─── Build Chat ───
  - name: 'gcr.io/cloud-builders/docker'
    args:
      - 'build'
      - '--build-arg'
      - 'NEXT_PUBLIC_API_URL=https://api.renovix.id'
      - '-t'
      - 'asia-southeast2-docker.pkg.dev/$PROJECT_ID/renovix/chat:$COMMIT_SHA'
      - '-t'
      - 'asia-southeast2-docker.pkg.dev/$PROJECT_ID/renovix/chat:latest'
      - '-f'
      - 'apps/chat/Dockerfile'
      - '.'
    id: 'build-chat'
    waitFor: ['-'] # Parallel with API build

  # ─── Build Dashboard ───
  - name: 'gcr.io/cloud-builders/docker'
    args:
      - 'build'
      - '--build-arg'
      - 'NEXT_PUBLIC_API_URL=https://api.renovix.id'
      - '-t'
      - 'asia-southeast2-docker.pkg.dev/$PROJECT_ID/renovix/dashboard:$COMMIT_SHA'
      - '-t'
      - 'asia-southeast2-docker.pkg.dev/$PROJECT_ID/renovix/dashboard:latest'
      - '-f'
      - 'apps/dashboard/Dockerfile'
      - '.'
    id: 'build-dashboard'
    waitFor: ['-']

  # ─── Build Landing ───
  - name: 'gcr.io/cloud-builders/docker'
    args:
      - 'build'
      - '-t'
      - 'asia-southeast2-docker.pkg.dev/$PROJECT_ID/renovix/landing:$COMMIT_SHA'
      - '-t'
      - 'asia-southeast2-docker.pkg.dev/$PROJECT_ID/renovix/landing:latest'
      - '-f'
      - 'apps/landing/Dockerfile'
      - '.'
    id: 'build-landing'
    waitFor: ['-']

  # ─── Push all images ───
  - name: 'gcr.io/cloud-builders/docker'
    args: ['push', '--all-tags', 'asia-southeast2-docker.pkg.dev/$PROJECT_ID/renovix/api']
    waitFor: ['build-api']

  - name: 'gcr.io/cloud-builders/docker'
    args: ['push', '--all-tags', 'asia-southeast2-docker.pkg.dev/$PROJECT_ID/renovix/chat']
    waitFor: ['build-chat']

  - name: 'gcr.io/cloud-builders/docker'
    args: ['push', '--all-tags', 'asia-southeast2-docker.pkg.dev/$PROJECT_ID/renovix/dashboard']
    waitFor: ['build-dashboard']

  - name: 'gcr.io/cloud-builders/docker'
    args: ['push', '--all-tags', 'asia-southeast2-docker.pkg.dev/$PROJECT_ID/renovix/landing']
    waitFor: ['build-landing']

  # ─── Run database migrations ───
  - name: 'gcr.io/cloud-builders/docker'
    args:
      - 'run'
      - '--network=cloudbuild'
      - 'asia-southeast2-docker.pkg.dev/$PROJECT_ID/renovix/api:$COMMIT_SHA'
      - 'npx'
      - 'prisma'
      - 'migrate'
      - 'deploy'
    env:
      - 'DATABASE_URL=$$DATABASE_URL'
    secretEnv: ['DATABASE_URL']
    id: 'migrate'
    waitFor: ['build-api']

  # ─── Deploy API ───
  - name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
    args:
      - 'gcloud'
      - 'run'
      - 'deploy'
      - 'renovix-api'
      - '--image'
      - 'asia-southeast2-docker.pkg.dev/$PROJECT_ID/renovix/api:$COMMIT_SHA'
      - '--region'
      - 'asia-southeast2'
      - '--no-traffic'  # Canary: deploy without routing traffic
    id: 'deploy-api'
    waitFor: ['migrate']

  # ─── Deploy Chat ───
  - name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
    args:
      - 'gcloud'
      - 'run'
      - 'deploy'
      - 'renovix-chat'
      - '--image'
      - 'asia-southeast2-docker.pkg.dev/$PROJECT_ID/renovix/chat:$COMMIT_SHA'
      - '--region'
      - 'asia-southeast2'
    id: 'deploy-chat'
    waitFor: ['build-chat']

  # ─── Deploy Dashboard ───
  - name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
    args:
      - 'gcloud'
      - 'run'
      - 'deploy'
      - 'renovix-dashboard'
      - '--image'
      - 'asia-southeast2-docker.pkg.dev/$PROJECT_ID/renovix/dashboard:$COMMIT_SHA'
      - '--region'
      - 'asia-southeast2'
    id: 'deploy-dashboard'
    waitFor: ['build-dashboard']

  # ─── Deploy Landing ───
  - name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
    args:
      - 'gcloud'
      - 'run'
      - 'deploy'
      - 'renovix-landing'
      - '--image'
      - 'asia-southeast2-docker.pkg.dev/$PROJECT_ID/renovix/landing:$COMMIT_SHA'
      - '--region'
      - 'asia-southeast2'
    id: 'deploy-landing'
    waitFor: ['build-landing']

availableSecrets:
  secretManager:
    - versionName: 'projects/$PROJECT_ID/secrets/database-url/versions/latest'
      env: 'DATABASE_URL'

options:
  logging: CLOUD_LOGGING_ONLY
  machineType: 'E2_HIGHCPU_8'

timeout: '1200s'
```

---

## 8. Cost Estimate

### Monthly Cost (1–100 users, production)

| Service | Spec | Cost (USD) |
|---------|------|------------|
| Cloud Run — API | 1 vCPU, 1GB, scale-to-zero | $0–8 |
| Cloud Run — Chat | 1 vCPU, 512MB, scale-to-zero | $0–5 |
| Cloud Run — Dashboard | 1 vCPU, 512MB, scale-to-zero | $0–5 |
| Cloud Run — Landing | 1 vCPU, 256MB, scale-to-zero | $0–2 |
| Cloud SQL (PostgreSQL) | db-f1-micro, 10GB SSD | $7–10 |
| GCS Storage | 5GB + lifecycle | $0.10 |
| Cloud CDN | 10GB egress | $1–2 |
| Secret Manager | 10 secrets | $0.06 |
| Artifact Registry | 5GB images | $0.50 |
| Cloud Build | 120 min/day free | $0 |
| VPC Connector | e2-micro × 2 | $7 |
| **Total** | | **$16–40/month** |

> **Security note:** No Cloud Armor (WAF) — relying on app-level protection (NestJS Throttler, Helmet, input validation, CORS). Add Cloud Armor Standard (~$12/month) later when scaling beyond 100 users or facing attacks.

### With Free Tier (First 12 months)

| Service | Free Tier |
|---------|-----------|
| Cloud Run | 2M requests, 360k vCPU-sec/month |
| Cloud SQL | — (no free tier, consider AlloyDB Omni) |
| GCS | 5GB/month |
| Cloud Build | 120 min/day |
| Secret Manager | 6 active versions |
| **Estimated with free tier** | **$8–20/month** |

---

## Deployment Checklist

```
Pre-deploy:
□ GCP project created with billing enabled
□ APIs enabled: Cloud Run, Cloud SQL, Secret Manager, Artifact Registry, Compute, VPC
□ Terraform state bucket created: gsutil mb gs://renovix-ai-terraform-state
□ Domain DNS configured (Cloud DNS or external)
□ SSL certificates provisioned (auto via Google-managed)

Terraform apply:
□ terraform init
□ terraform plan -var-file=environments/production.tfvars
□ terraform apply -var-file=environments/production.tfvars

Post-deploy:
□ Verify health endpoints for all services
□ Run smoke tests against production
□ Set up monitoring alerts (Error Rate > 1%, Latency P99 > 2s)
□ Enable Cloud Logging export to BigQuery (audit trail)
□ Schedule weekly terraform plan (drift detection)
```

---

## 9. Development Environment Strategy

### Dev vs Production Comparison

| Aspect | Development (Local) | Production (GCP) |
|--------|--------------------:|:-----------------|
| Database | Docker PostgreSQL + pgvector | Cloud SQL |
| Storage | MinIO (S3-compatible) | GCS via HMAC |
| API | `nx serve api` (hot reload) | Cloud Run container |
| Chat | `nx serve chat` (hot reload) | Cloud Run container |
| Dashboard | `nx serve dashboard` (hot reload) | Cloud Run container |
| Landing | `nx serve landing` (hot reload) | Cloud Run container |
| Redis | Docker (optional) | Memorystore (optional) |
| Secrets | `.env` file | Secret Manager |
| CORS | Allow all origins | Strict whitelist |
| Rate Limiting | Relaxed (60/min) | Strict (per endpoint) |
| Body Limit | 50MB (for dev uploads) | 1MB |
| Logging | Debug + verbose | Error + warn only |
| SSL | None (http://localhost) | Managed certs (https) |
| CDN | None | Cloud CDN |

---

### 9.1 Local Development Setup

#### Prerequisites

```bash
# Required
node >= 22
docker >= 24
npm >= 10

# Optional
gcloud CLI  # for testing GCS/Cloud Run locally
```

#### Quick Start

```bash
# 1. Start infrastructure (Postgres + MinIO)
docker compose up -d

# 2. Copy environment file
cp .env.example .env

# 3. Install dependencies
npm install

# 4. Run database migrations
npx prisma migrate dev

# 5. Seed database (optional)
npx prisma db seed

# 6. Start all services (parallel)
npx nx run-many -t serve -p api chat dashboard landing
```

#### `.env.example` (Development)

```env
# ─── App ───
NODE_ENV=development
PORT=3000
HOST=0.0.0.0

# ─── Database ───
DATABASE_URL=postgresql://renovix:renovix_dev@localhost:5432/renovix_ai

# ─── Auth ───
JWT_SECRET=dev-jwt-secret-change-in-production
JWT_EXPIRES_IN=30d

# ─── Storage (MinIO - local S3) ───
S3_BUCKET=renovix-ai
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_ENDPOINT=http://localhost:9000
S3_CDN_DOMAIN=localhost:9000

# ─── AI ───
TOGETHER_API_KEY=your-together-api-key

# ─── Billing (test mode) ───
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_test_xxx

# ─── URLs ───
DASHBOARD_URL=http://localhost:4200
CHAT_URL=http://localhost:4300
LANDING_URL=http://localhost:3001
API_URL=http://localhost:3000
```

---

### 9.2 Docker Compose (Development)

Your existing `docker-compose.yml` is already well-configured. Enhanced version with all services:

```yaml
# docker-compose.yml (Development)
services:
  # ─── PostgreSQL with pgvector ───
  postgres:
    image: pgvector/pgvector:pg16
    restart: unless-stopped
    environment:
      POSTGRES_USER: renovix
      POSTGRES_PASSWORD: renovix_dev
      POSTGRES_DB: renovix_ai
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U renovix -d renovix_ai"]
      interval: 5s
      timeout: 5s
      retries: 5

  # ─── MinIO (S3-compatible local storage) ───
  minio:
    image: minio/minio:latest
    restart: unless-stopped
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    ports:
      - "9000:9000"   # S3 API
      - "9001:9001"   # Console UI
    volumes:
      - miniodata:/data
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 5s
      timeout: 5s
      retries: 5

  # ─── Create default S3 bucket ───
  minio-init:
    image: minio/mc:latest
    depends_on:
      minio:
        condition: service_healthy
    entrypoint: >
      /bin/sh -c "
        mc alias set local http://minio:9000 minioadmin minioadmin;
        mc mb local/renovix-ai --ignore-existing;
        exit 0;
      "

  # ─── Redis (for rate limiting / caching) ───
  redis:
    image: redis:7-alpine
    restart: unless-stopped
    ports:
      - "6379:6379"
    volumes:
      - redisdata:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5

  # ─── Mailpit (local email testing) ───
  mailpit:
    image: axllent/mailpit:latest
    restart: unless-stopped
    ports:
      - "1025:1025"   # SMTP
      - "8025:8025"   # Web UI
    environment:
      MP_SMTP_AUTH_ACCEPT_ANY: 1
      MP_SMTP_AUTH_ALLOW_INSECURE: 1

volumes:
  pgdata:
  miniodata:
  redisdata:
```

#### Dev Tools Accessible At:

| Tool | URL | Purpose |
|------|-----|---------|
| API | http://localhost:3000/api | Backend API |
| API Docs (back office) | http://127.0.0.1:8081 | Swagger UI (docker compose docs-backoffice) |
| API Docs (portal) | http://127.0.0.1:8082 | Swagger UI (docker compose docs-portal) |
| Chat | http://localhost:4300 | Chat portal |
| Dashboard | http://localhost:4200 | Dashboard |
| Landing | http://localhost:3001 | Landing page |
| MinIO Console | http://localhost:9001 | S3 file browser |
| Mailpit | http://localhost:8025 | Email inbox |
| Prisma Studio | http://localhost:5555 | Database GUI |

---

### 9.3 Nx Serve Commands

```bash
# Individual services
npx nx serve api              # http://localhost:3000
npx nx serve chat             # http://localhost:4300
npx nx serve dashboard        # http://localhost:4200
npx nx serve landing          # http://localhost:3001

# All at once
npx nx run-many -t serve -p api chat dashboard landing

# With specific targets
npx nx serve api --configuration=development
```

#### `project.json` ports (ensure consistency):

| App | Port | Dev URL |
|-----|------|---------|
| API | 3000 | http://localhost:3000/api |
| Chat | 4300 | http://localhost:4300 |
| Dashboard | 4200 | http://localhost:4200 |
| Landing | 3001 | http://localhost:3001 |

---

### 9.4 Next.js Dev Config

```js
// apps/chat/next.config.js (already supports dev via nx)
const nextConfig = {
  nx: {},
  output: process.env.NODE_ENV === 'production' ? 'standalone' : undefined,
  
  // Only add security headers in production
  ...(process.env.NODE_ENV === 'production' && {
    async headers() {
      return [/* security headers */];
    },
  }),

  poweredByHeader: false,
  reactStrictMode: true,
};
```

Key difference: `output: 'standalone'` is only needed for Docker builds, not local dev.

---

### 9.5 Database Workflow (Dev)

```bash
# Create a new migration
npx prisma migrate dev --name add_feature_x

# Reset database (destructive)
npx prisma migrate reset

# Open Prisma Studio (GUI)
npx prisma studio

# Generate client after schema change
npx prisma generate

# Seed data
npx prisma db seed
```

---

### 9.6 Testing Against GCP Services Locally

If you need to test against real GCP services from local:

```bash
# Authenticate with GCP
gcloud auth application-default login

# Use real GCS bucket locally (swap env vars)
S3_ENDPOINT=""  # Remove MinIO endpoint
S3_BUCKET=renovix-ai-storage-PROJECT_ID
S3_ACCESS_KEY_ID=GOOG...  # HMAC key
S3_SECRET_ACCESS_KEY=...

# Connect to Cloud SQL via proxy
gcloud sql connect renovix-db-asia-southeast2 --user=renovix_app --database=renovix_ai

# Or use Cloud SQL Proxy
cloud-sql-proxy --port 5433 PROJECT:asia-southeast2:renovix-db-asia-southeast2
# Then: DATABASE_URL=postgresql://renovix_app:xxx@localhost:5433/renovix_ai
```

---

### 9.7 Dev Scripts (package.json)

```json
{
  "scripts": {
    "dev": "docker compose up -d && npx nx run-many -t serve -p api chat dashboard landing",
    "dev:api": "docker compose up -d postgres minio && npx nx serve api",
    "dev:chat": "npx nx serve chat",
    "dev:dashboard": "npx nx serve dashboard",
    "dev:landing": "npx nx serve landing",
    "dev:infra": "docker compose up -d",
    "dev:infra:down": "docker compose down",
    "dev:db:migrate": "npx prisma migrate dev",
    "dev:db:reset": "npx prisma migrate reset",
    "dev:db:seed": "npx prisma db seed",
    "dev:db:studio": "npx prisma studio",
    "dev:test": "npx nx run-many -t test",
    "dev:lint": "npx nx run-many -t lint",
    "dev:build": "npx nx run-many -t build",
    "dev:docker:api": "docker build -f apps/api/Dockerfile -t renovix-api:dev .",
    "dev:docker:chat": "docker build -f apps/chat/Dockerfile -t renovix-chat:dev ."
  }
}
```

---

### 9.8 Environment Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     Development Flow                             │
└─────────────────────────────────────────────────────────────────┘

Local (your machine)
│
├── docker compose up          → Postgres, MinIO, Redis, Mailpit
├── nx serve api               → Hot reload on :3000
├── nx serve chat              → Hot reload on :4300
├── nx serve dashboard         → Hot reload on :4200
└── nx serve landing           → Hot reload on :3001

        │ git push
        ▼

Cloud Build (CI)
│
├── npm audit                  → Security check
├── nx run-many -t lint        → Lint all
├── nx run-many -t test        → Test all
├── docker build (all apps)    → Build images
└── Push to Artifact Registry

        │ auto-deploy (main branch)
        ▼

Production (GCP Cloud Run)
│
├── renovix-api               → api.renovix.id
├── renovix-chat              → chat.renovix.id
├── renovix-dashboard         → dashboard.renovix.id
└── renovix-landing           → renovix.id
```

---

### 9.10 Dev vs Prod Summary

| | Local Dev | Production (GCP) |
|--|-----------|------------------|
| **Infra** | Docker Compose | Terraform (full) |
| **Database** | Local Postgres | Cloud SQL (micro→custom) |
| **Storage** | MinIO | GCS + CDN |
| **Containers** | `nx serve` (no Docker) | Cloud Run |
| **Secrets** | `.env` file | Secret Manager |
| **SSL** | None | Auto (Google) |
| **Domain** | localhost | renovix.id |
| **CORS** | Allow all | Strict whitelist |
| **Logging** | Debug + verbose | Error only |
| **Cost** | $0 | ~$16–40/month |
| **Purpose** | Daily coding | Real users |

---

*Last updated: May 2026*
