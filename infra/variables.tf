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
  description = "Environment (production)"
  type        = string
  default     = "production"
}

variable "domain" {
  description = "Primary domain"
  type        = string
  default     = "renovix.id"
}

variable "admin_origin" {
  description = "Origin of the back-office app, e.g. https://admin.renovix.id (RX-156): the only Origin /admin routes accept; no default, the API does not start without it"
  type        = string
}

variable "db_tier" {
  description = "Cloud SQL instance tier"
  type        = string
  default     = "db-f1-micro"
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

variable "better_auth_secret" {
  description = "Better Auth signing secret for SSO sessions"
  type        = string
  sensitive   = true
}

variable "oauth_support_email" {
  description = "Support email displayed on Google OAuth consent screen"
  type        = string
}

variable "mcp_encryption_key" {
  description = "AES-256 key for encrypting MCP OAuth tokens (base64-encoded 32 bytes)"
  type        = string
  sensitive   = true
}
