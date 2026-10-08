# ─── Secret Manager ───
locals {
  # Secrets that Terraform auto-populates (it knows the values)
  auto_secrets = {
    DATABASE_URL        = var.db_url
    JWT_SECRET          = var.jwt_secret
    BETTER_AUTH_SECRET  = var.better_auth_secret
  }

  # Secrets that Terraform creates as empty — you set them manually after deploy
  manual_secrets = [
    "OPENROUTER_API_KEY",
    "OPENROUTER_APP_TITLE",
    "OPENROUTER_APP_URL",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
    "GOOGLE_CLOUD_PROJECT_ID",
    "GOOGLE_CLOUD_BUCKET_NAME",
  ]

  all_secret_keys = concat(keys(local.auto_secrets), local.manual_secrets)
}

# Create all secret entries
resource "google_secret_manager_secret" "secrets" {
  for_each  = toset(local.all_secret_keys)
  secret_id = lower(replace(each.key, "_", "-"))
  project   = var.project_id

  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }
}

# Auto-populate the secrets Terraform knows
resource "google_secret_manager_secret_version" "auto" {
  for_each    = local.auto_secrets
  secret      = google_secret_manager_secret.secrets[each.key].id
  secret_data = each.value
}

# ┌─────────────────────────────────────────────────────────────────┐
# │  AFTER `terraform apply`, set the manual secrets via gcloud:    │
# │                                                                 │
# │  gcloud secrets versions add openrouter-api-key \               │
# │    --data-file=- <<< "your-openrouter-api-key-here"             │
# │                                                                 │
# │  gcloud secrets versions add openrouter-app-title \             │
# │    --data-file=- <<< "Renovix AI"                               │
# │                                                                 │
# │  gcloud secrets versions add openrouter-app-url \               │
# │    --data-file=- <<< "https://renovix.id"                       │
# │                                                                 │
# │  gcloud secrets versions add stripe-secret-key \                │
# │    --data-file=- <<< "sk_live_xxx"  (when re-enabled)           │
# │                                                                 │
# │  gcloud secrets versions add stripe-webhook-secret \            │
# │    --data-file=- <<< "whsec_xxx"   (when re-enabled)            │
# │                                                                 │
# │  gcloud secrets versions add s3-access-key-id \                 │
# │    --data-file=- <<< "GOOG1E..."                                │
# │                                                                 │
# │  gcloud secrets versions add s3-secret-access-key \             │
# │    --data-file=- <<< "abc123..."                                │
# │                                                                 │
# │  (OAuth secrets are managed by modules/oauth — see there)       │
# └─────────────────────────────────────────────────────────────────┘
