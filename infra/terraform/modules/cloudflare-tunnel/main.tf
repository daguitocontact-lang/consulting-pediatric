# Cloudflare Tunnel (Zero Trust, token-based) + DNS. The `cloudflared` sidecar in
# the ECS task dials OUT and Cloudflare routes the public hostname to it — no ALB,
# no public IP, no inbound SG rules. Daguito has no tunnel module, so this is new.
#
# Provider auth: CLOUDFLARE_API_TOKEN from env (same convention as Daguito).

terraform {
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

variable "name" { type = string } # "pediatric-prod"
variable "account_id" { type = string }
variable "zone_id" { type = string }  # daguito.com zone
variable "hostname" { type = string } # "api.pediatric.daguito.com"
variable "service_port" {
  type    = number
  default = 8080
}
variable "ssm_prefix" { type = string } # "/pediatric/prod"

resource "random_id" "secret" {
  byte_length = 35
}

resource "cloudflare_zero_trust_tunnel_cloudflared" "this" {
  account_id    = var.account_id
  name          = var.name
  tunnel_secret = base64encode(random_id.secret.b64_std)
  config_src    = "cloudflare"
}

# Route the hostname → the api container on localhost inside the task.
resource "cloudflare_zero_trust_tunnel_cloudflared_config" "this" {
  account_id = var.account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.this.id
  config = {
    ingress = [
      {
        hostname = var.hostname
        service  = "http://localhost:${var.service_port}"
      },
      { service = "http_status:404" }
    ]
  }
}

# Public DNS: proxied CNAME to the tunnel.
resource "cloudflare_dns_record" "this" {
  zone_id = var.zone_id
  name    = var.hostname
  type    = "CNAME"
  content = "${cloudflare_zero_trust_tunnel_cloudflared.this.id}.cfargotunnel.com"
  proxied = true
  ttl     = 1
}

# The run token (provider v5 exposes it via a data source, not the resource).
data "cloudflare_zero_trust_tunnel_cloudflared_token" "this" {
  account_id = var.account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.this.id
}

# The run token the cloudflared sidecar uses → SSM (read by the ECS task).
resource "aws_ssm_parameter" "tunnel_token" {
  name  = "${var.ssm_prefix}/tunnel-token"
  type  = "SecureString"
  value = data.cloudflare_zero_trust_tunnel_cloudflared_token.this.token
}

output "tunnel_token_ssm_arn" { value = aws_ssm_parameter.tunnel_token.arn }
output "hostname" { value = var.hostname }
