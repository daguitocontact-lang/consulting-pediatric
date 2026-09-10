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

  # Jitsi rooms are gated whenever there is a secret to gate them with — either
  # one that was handed to us (the legacy server's) or the one this stack
  # generates for its own box. Kept out of the resources' `count` as a plain
  # boolean, because a count cannot depend on a value that is only known after
  # apply (the generated secret is exactly that).
  jitsi_secured  = var.jitsi_self_hosted || var.jitsi_app_secret != ""
  jitsi_app_id   = var.jitsi_app_id != "" ? var.jitsi_app_id : (var.jitsi_self_hosted ? var.client_name : "")
  jitsi_secret   = var.jitsi_app_secret != "" ? var.jitsi_app_secret : (var.jitsi_self_hosted ? random_password.jitsi_app_secret[0].result : "")
  jitsi_ssm_name = "${local.ssm_api}/JITSI_APP_SECRET"

  # Where the CONSULTATIONS go, which is not always where our box is. The
  # secret still exists in SSM (the box reads it from there) — it just is not
  # handed to the API, because credentials for our prosody mean nothing to
  # somebody else's server, and a half-configuration is exactly what
  # lib/jitsi.ts refuses to sign with.
  jitsi_api_domain  = var.jitsi_api_domain != "" ? var.jitsi_api_domain : var.jitsi_domain
  jitsi_api_secured = local.jitsi_secured && var.jitsi_api_domain == ""
}

# The room-signing secret, when nobody brought one. Generated rather than typed
# into prod.tfvars: the API signs with it and the box verifies with it, both
# read it from the same SSM parameter, and no human ever needs to know it.
resource "random_password" "jitsi_app_secret" {
  count   = var.jitsi_self_hosted && var.jitsi_app_secret == "" ? 1 : 0
  length  = 48
  special = false # it travels through debconf and a prosody config file
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

# ── Key that mints the consultation's stream tokens ──────────────────
# The account key of the Daguito account that OWNS the consultation flows
# (realtime-consultation, in-person-consultation, pre-recorded-consultation,
# consultation-chatbot). src/lib/daguito-stream.ts resolves the flow webhook
# with it and mints a per-session token; the key itself never leaves the task.
# Empty = /stream/token and /chat answer 503 and the panel says so — the room,
# the note by hand and the assistant thread still work.
resource "aws_ssm_parameter" "daguito_stream_api_key" {
  count = var.daguito_stream_api_key == "" ? 0 : 1
  name  = "${local.ssm_api}/DAGUITO_STREAM_API_KEY"
  type  = "SecureString"
  value = var.daguito_stream_api_key
}

# ── Jitsi room signing key ───────────────────────────────────────────
# The rooms are only as private as this secret: without it the API signs no
# token and Jitsi lets anyone with the room name in (the API says so in its
# logs, and the room names are random for exactly that reason).
resource "aws_ssm_parameter" "jitsi_app_secret" {
  count = local.jitsi_secured ? 1 : 0
  name  = local.jitsi_ssm_name
  type  = "SecureString"
  value = local.jitsi_secret
}

# ── The client's own Jitsi ───────────────────────────────────────────
# EC2 + Elastic IP in Daguito's PUBLIC subnets, which is the only place in this
# stack where anything is reachable from the internet without a tunnel. It has
# to be: the media is UDP/10000. See COST.md — this box roughly doubles the
# monthly bill, and it is the one resource here that does.
module "jitsi" {
  count  = var.jitsi_self_hosted ? 1 : 0
  source = "../../modules/jitsi"

  name     = "${local.name}-jitsi"
  hostname = var.jitsi_domain
  region   = var.region
  vpc_id   = module.network.vpc_id
  # One box, one subnet: the first public one, sorted, so it stays put.
  subnet_id                    = module.network.public_subnet_ids[0]
  zone_id                      = var.cloudflare_zone_id
  ssh_source_security_group_id = module.network.bastion_security_group_id

  instance_type     = var.jitsi_instance_type
  video_height      = var.jitsi_video_height
  letsencrypt_email = var.jitsi_letsencrypt_email

  app_id = local.jitsi_app_id
  # By name and by arn: the box reads the parameter at boot (the name) and its
  # role is scoped to that one parameter (the arn). The secret itself never
  # reaches user_data, which is readable to anyone with ec2:DescribeInstance*.
  app_secret_ssm_name = local.jitsi_ssm_name
  app_secret_ssm_arn  = aws_ssm_parameter.jitsi_app_secret[0].arn
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
    JITSI_DOMAIN = local.jitsi_api_domain
    JITSI_APP_ID = local.jitsi_api_secured ? local.jitsi_app_id : ""
    # Where the panel is served from. The API needs it twice and both have to
    # agree (src/lib/panel-origin.ts): the patient's link is built from it and
    # the CORS allow-list is opened for it. Same value the r2_panel module
    # publishes, so the two cannot drift apart.
    PANEL_BASE_URL = module.r2_panel.panel_url
    # Where the PATIENT's page is served from, when that is not our bucket:
    # a parent opens an app.daguito.com link rather than a bucket hostname.
    # Empty falls back to <panel>/patient.html, which is what this repo
    # deploys. Daguito has to serve (or proxy) the route this names.
    PATIENT_BASE_URL = var.patient_base_url
    # The private documents bucket (src/lib/storage.ts). The credentials go in
    # as secrets below, but the driver only turns on when all FOUR are present:
    # without these two the API boots, logs "no R2_* configured" and writes the
    # uploads to the task's own disk, where the next deploy throws them away.
    R2_ACCOUNT_ID = var.cloudflare_account_id
    R2_BUCKET     = module.r2_documents.bucket_name
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
    local.jitsi_api_secured ? {
      JITSI_APP_SECRET = aws_ssm_parameter.jitsi_app_secret[0].arn
    } : {},
    var.daguito_stream_api_key == "" ? {} : {
      DAGUITO_STREAM_API_KEY = aws_ssm_parameter.daguito_stream_api_key[0].arn
    },
    var.r2_access_key_id == "" ? {} : {
      R2_ACCESS_KEY_ID = aws_ssm_parameter.r2_access_key_id[0].arn
    },
    var.r2_secret_access_key == "" ? {} : {
      R2_SECRET_ACCESS_KEY = aws_ssm_parameter.r2_secret_access_key[0].arn
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

