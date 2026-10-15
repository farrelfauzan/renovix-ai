# ─── Networking ───
module "networking" {
  source     = "./modules/networking"
  project_id = var.project_id
  region     = var.region
}

# ─── Database ───
module "database" {
  source      = "./modules/database"
  project_id  = var.project_id
  region      = var.region
  network_id  = module.networking.vpc_id
  db_tier     = var.db_tier
  db_password = var.db_password

  depends_on = [module.networking]
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
  source             = "./modules/security"
  project_id         = var.project_id
  region             = var.region
  db_url             = module.database.connection_url
  jwt_secret         = var.jwt_secret
  better_auth_secret = var.better_auth_secret
}

# ─── OAuth (SSO + MCP Integrations) ───
module "oauth" {
  source              = "./modules/oauth"
  project_id          = var.project_id
  domain              = var.domain
  oauth_support_email = var.oauth_support_email
  mcp_encryption_key  = var.mcp_encryption_key
}

# ─── Cloud Run Services ───
module "cloud_run" {
  source             = "./modules/cloud-run"
  project_id         = var.project_id
  region             = var.region
  vpc_connector_id   = module.networking.vpc_connector_id
  db_connection_name = module.database.connection_name
  secrets            = merge(module.security.secret_ids, module.oauth.secret_ids)
  bucket_name        = module.storage.bucket_name
  domain             = var.domain
  admin_origin       = var.admin_origin
}

# ─── CDN + Load Balancer ───
module "cdn" {
  source          = "./modules/cdn"
  project_id      = var.project_id
  domain          = var.domain
  cloud_run       = module.cloud_run.services
  storage_backend = module.storage.bucket_backend
}
