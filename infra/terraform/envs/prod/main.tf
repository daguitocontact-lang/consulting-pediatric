# Custom "<client>" prod: reuses Daguito's VPC/NAT/bastion, adds its own RDS +
# ECS(Fargate+cloudflared) + Cloudflare tunnel + ECR + Resource Group.

data "aws_caller_identity" "current" {}

locals {
  name     = "${var.client_name}-${var.env}" # pediatric-prod
  api_repo = "${var.client_name}-api"        # pediatric-api
  ssm_api  = "/${var.client_name}/${var.env}/api"
  ssm_root = "/${var.client_name}/${var.env}"
  # Constructed SSM ARNs break the RDS<->ECS cycle (ECS references them by name,
  # RDS creates the DATABASE_URL param at the same name).
  database_url_arn = "arn:aws:ssm:${var.region}:${data.aws_caller_identity.current.account_id}:parameter${local.ssm_api}/DATABASE_URL"
  jwt_pubkey_arn   = aws_ssm_parameter.daguito_jwt_public_key.arn
}

# ── Daguito network (data-only) ──────────────────────────────────────
module "network" {
  source      = "../../modules/network"
  daguito_env = var.env
}

# ── ECR ──────────────────────────────────────────────────────────────
module "ecr" {
  source = "../../modules/ecr"
  name   = local.api_repo
}

# ── Cloudflare tunnel + DNS (API) ────────────────────────────────────
module "cloudflare_tunnel" {
  source       = "../../modules/cloudflare-tunnel"
  name         = local.name
  account_id   = var.cloudflare_account_id
  zone_id      = var.cloudflare_zone_id
  hostname     = var.domain
  service_port = 8080
  ssm_prefix   = local.ssm_root
}

# ── R2 + CDN for the micro-frontend panel (separate from the API) ─────
module "r2_panel" {
  source         = "../../modules/r2-panel"
  bucket_name    = "${var.client_name}-panel"
  account_id     = var.cloudflare_account_id
  zone_id        = var.cloudflare_zone_id
  domain         = "${var.client_name}-panel.daguito.com"
  allowed_origin = var.daguito_web_origin
}

# ── R2 for the passengers' ID scans (private, API-only) ──────────────
module "r2_documents" {
  source      = "../../modules/r2-documents"
  bucket_name = "${var.client_name}-docs"
  account_id  = var.cloudflare_account_id
}

# The S3 credentials for that bucket. SecureString: this pair can read every
# document in it. Created only when both are set — without them the API boots
# and serves normally, and only the upload/read of a document degrades to the
# task's own disk (see apps/api/src/lib/storage.ts).
resource "aws_ssm_parameter" "r2_access_key_id" {
  count = var.r2_access_key_id == "" ? 0 : 1
  name  = "${local.ssm_api}/R2_ACCESS_KEY_ID"
  type  = "SecureString"
  value = var.r2_access_key_id
}

resource "aws_ssm_parameter" "r2_secret_access_key" {
  count = var.r2_secret_access_key == "" ? 0 : 1
  name  = "${local.ssm_api}/R2_SECRET_ACCESS_KEY"
  type  = "SecureString"
  value = var.r2_secret_access_key
}

# ── Daguito's RS256 public key so the custom can verify panel/agent tokens ──
resource "aws_ssm_parameter" "daguito_jwt_public_key" {
  name  = "${local.ssm_api}/DAGUITO_JWT_PUBLIC_KEY"
  type  = "String"
  value = var.daguito_jwt_public_key
}

# ── Account key this custom registers its contact fields with ────────
# SecureString, unlike the public key above: this one IS a credential. Created
# only when a key is set — an empty var leaves the whole registration off (the
# API logs it and boots).
resource "aws_ssm_parameter" "daguito_api_key" {
  count = var.daguito_api_key == "" ? 0 : 1
  name  = "${local.ssm_api}/DAGUITO_API_KEY"
  type  = "SecureString"
  value = var.daguito_api_key
}

# ── Secret of the inbound ticket webhook ─────────────────────────────
resource "aws_ssm_parameter" "daguito_webhook_secret" {
  count = var.daguito_webhook_secret == "" ? 0 : 1
  name  = "${local.ssm_api}/DAGUITO_WEBHOOK_SECRET"
  type  = "SecureString"
  value = var.daguito_webhook_secret
}

# ── Jitsi room signing key ───────────────────────────────────────────
# The rooms are only as private as this secret: without it the API signs no
# token and Jitsi lets anyone with the room name in (the API says so in its
# logs, and the room names are random for exactly that reason).
resource "aws_ssm_parameter" "jitsi_app_secret" {
  count = var.jitsi_app_secret == "" ? 0 : 1
  name  = "${local.ssm_api}/JITSI_APP_SECRET"
  type  = "SecureString"
  value = var.jitsi_app_secret
}

# ── ECS service (api + cloudflared) ──────────────────────────────────
module "ecs" {
  source               = "../../modules/ecs-fargate-cloudflared"
  name                 = "${local.name}-api"
  cluster_name         = local.name
  image                = var.image
  region               = var.region
  vpc_id               = module.network.vpc_id
  subnet_ids           = module.network.private_subnet_ids
  container_port       = 8080
  tunnel_token_ssm_arn = module.cloudflare_tunnel.tunnel_token_ssm_arn
  env = {
    NODE_ENV        = "production"
    PORT            = "8080"
    ALLOWED_ORIGIN  = var.daguito_web_origin
    DAGUITO_ORG_IDS = var.daguito_org_ids
    # Outbound: registering the contact custom fields at boot (src/daguito).
    DAGUITO_API_BASE = var.daguito_api_base
    # The video room every consultation owns (src/lib/jitsi.ts). The panel is
    # handed the domain at runtime, so it is configured here and not in a build.
    JITSI_DOMAIN = var.jitsi_domain
    JITSI_APP_ID = var.jitsi_app_id
  }
  secret_ssm_arns = merge(
    {
      DATABASE_URL           = local.database_url_arn
      DAGUITO_JWT_PUBLIC_KEY = local.jwt_pubkey_arn
    },
    var.daguito_api_key == "" ? {} : {
      DAGUITO_API_KEY = aws_ssm_parameter.daguito_api_key[0].arn
    },
    var.daguito_webhook_secret == "" ? {} : {
      DAGUITO_WEBHOOK_SECRET = aws_ssm_parameter.daguito_webhook_secret[0].arn
    },
    var.jitsi_app_secret == "" ? {} : {
      JITSI_APP_SECRET = aws_ssm_parameter.jitsi_app_secret[0].arn
    },
  )
}

# ── RDS (whitelists the ECS task SG + the bastion) ───────────────────
module "rds" {
  source                    = "../../modules/rds-postgres"
  name                      = "${local.name}-db"
  db_name                   = var.db_name
  db_username               = var.db_username
  vpc_id                    = module.network.vpc_id
  subnet_ids                = module.network.private_subnet_ids
  bastion_security_group_id = module.network.bastion_security_group_id
  client_security_group_ids = [module.ecs.task_security_group_id]
  ssm_prefix                = local.ssm_api
}

# ── AWS Resource Group: everything tagged Client=<client> in one view ─
resource "aws_resourcegroups_group" "this" {
  name = local.name
  resource_query {
    query = jsonencode({
      ResourceTypeFilters = ["AWS::AllSupported"]
      TagFilters = [
        { Key = "Client", Values = [var.client_name] },
        { Key = "Env", Values = [var.env] },
      ]
    })
  }
}

# ── CI deploy role (GitHub Actions OIDC) ─────────────────────────────
# deploy-api.yml assumes this; its ARN is the repo secret AWS_DEPLOY_ROLE_ARN.
module "github_oidc" {
  source             = "../../modules/github-oidc"
  name               = "${local.name}-ci-deploy"
  github_repo        = var.github_repo
  github_repo_ids    = var.github_repo_ids
  ecr_repository_arn = module.ecr.repository_arn
  ecs_exec_role_arn  = module.ecs.exec_role_arn
  ecs_task_role_arn  = module.ecs.task_role_arn
  log_group_arn      = module.ecs.log_group_arn
}

