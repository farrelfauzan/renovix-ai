# ─── Service Accounts ───
resource "google_service_account" "api" {
  account_id   = "renovix-api-sa"
  display_name = "Renovix API Service Account"
  project      = var.project_id
}

resource "google_service_account" "frontend" {
  account_id   = "renovix-frontend-sa"
  display_name = "Renovix Frontend Service Account"
  project      = var.project_id
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

# ─── Artifact Registry ───
resource "google_artifact_registry_repository" "images" {
  location      = var.region
  repository_id = "renovix"
  format        = "DOCKER"
  project       = var.project_id

  cleanup_policies {
    id     = "keep-last-5"
    action = "KEEP"
    most_recent_versions {
      keep_count = 5
    }
  }
}

# ─── API Service ───
resource "google_cloud_run_v2_service" "api" {
  name     = "renovix-api"
  location = var.region
  project  = var.project_id

  template {
    service_account = google_service_account.api.email

    vpc_access {
      connector = var.vpc_connector_id
      egress    = "PRIVATE_RANGES_ONLY"
    }

    containers {
      image = "${var.region}-docker.pkg.dev/${var.project_id}/renovix/api:latest"

      ports {
        container_port = 3000
      }

      resources {
        limits = {
          memory = "1Gi"
          cpu    = "1"
        }
        cpu_idle = true
      }

      # Secrets from Secret Manager
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

      env {
        name  = "S3_ENDPOINT"
        value = "https://storage.googleapis.com"
      }

      env {
        name  = "S3_REGION"
        value = var.region
      }

      env {
        name  = "S3_BUCKET"
        value = var.bucket_name
      }

      env {
        name  = "S3_CDN_DOMAIN"
        value = "cdn.${var.domain}"
      }

      env {
        name  = "API_PUBLIC_URL"
        value = "https://api.${var.domain}"
      }

      env {
        name  = "DASHBOARD_URL"
        value = "https://dashboard.${var.domain}"
      }

      env {
        name  = "CHAT_APP_URL"
        value = "https://chat.${var.domain}"
      }

      env {
        name  = "CORS_ORIGIN"
        value = "https://chat.${var.domain},https://dashboard.${var.domain},https://${var.domain},https://www.${var.domain}"
      }

      env {
        name  = "ADMIN_ORIGIN"
        value = var.admin_origin
      }

      env {
        name  = "GOOGLE_OAUTH_REDIRECT_URI"
        value = "https://api.${var.domain}/api/v1/mcp/user/oauth/callback"
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
  project  = var.project_id

  template {
    service_account = google_service_account.frontend.email

    containers {
      image = "${var.region}-docker.pkg.dev/${var.project_id}/renovix/chat:latest"

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
        value = "https://api.${var.domain}/api/v1"
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
  project  = var.project_id

  template {
    service_account = google_service_account.frontend.email

    containers {
      image = "${var.region}-docker.pkg.dev/${var.project_id}/renovix/dashboard:latest"

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
        value = "https://api.${var.domain}/api/v1"
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
  project  = var.project_id

  template {
    service_account = google_service_account.frontend.email

    containers {
      image = "${var.region}-docker.pkg.dev/${var.project_id}/renovix/landing:latest"

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

# ─── Public Access (all services behind app-level auth) ───
resource "google_cloud_run_v2_service_iam_member" "api_public" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.api.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_service_iam_member" "chat_public" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.chat.name
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

resource "google_cloud_run_v2_service_iam_member" "landing_public" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.landing.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
