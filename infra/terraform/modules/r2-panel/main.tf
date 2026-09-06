# The micro-frontend panel served as static from Cloudflare R2 + CDN (like
# Daguito's web) — separate from the API. CORS restricts loading to Daguito's
# origin only, so the Module Federation remote can be imported ONLY from
# https://app.daguito.com (the browser blocks any other origin). The panel UI
# holds no secrets; sensitive data stays behind the token-gated API.

terraform {
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }
}

variable "bucket_name" { type = string } # "pediatric-panel"
variable "account_id" { type = string }
variable "zone_id" { type = string }
variable "domain" { type = string }         # "pediatric-panel.daguito.com"
variable "allowed_origin" { type = string } # "https://app.daguito.com"

variable "manage_cache_rule" {
  type        = bool
  default     = true
  description = "Create the zone cache rule that lets panel.js expire on its own. Cloudflare allows ONE ruleset per phase per zone, so a SECOND custom sharing daguito.com must set this to false and add its hostname to the first one's rule instead."
}

resource "cloudflare_r2_bucket" "this" {
  account_id = var.account_id
  name       = var.bucket_name
  location   = "ENAM"
}

# Public custom domain (Cloudflare-proxied, TLS at the edge).
resource "cloudflare_r2_custom_domain" "this" {
  account_id  = var.account_id
  bucket_name = cloudflare_r2_bucket.this.name
  domain      = var.domain
  zone_id     = var.zone_id
  enabled     = true
  min_tls     = "1.2"
}

# Only Daguito's origin may import the federated remote (browser-enforced).
resource "cloudflare_r2_bucket_cors" "this" {
  account_id  = var.account_id
  bucket_name = cloudflare_r2_bucket.this.name
  rules = [{
    allowed = {
      origins = [var.allowed_origin]
      methods = ["GET", "HEAD"]
      headers = ["*"]
    }
    max_age_seconds = 3600
  }]
}

output "bucket_name" { value = cloudflare_r2_bucket.this.name }
output "panel_url" { value = "https://${var.domain}" }

# ── Why a cache rule at all ──────────────────────────────────────────
# Daguito imports ONE url (`…/panel.js`), so there is no hashed filename to
# make immutable: a deploy has to propagate on its own. The upload already
# sets `Cache-Control: public, max-age=60, must-revalidate`, and the zone's
# default Browser Cache TTL was overriding it with FOUR HOURS — which is why
# every panel release used to come with a manual "bump the ?b= on the org's
# remote_url in Daguito". This rule hands the decision back to the object:
# respect what R2 sends, at the edge and in the browser.
#
# `deploy-panel.yml` still purges the URL after uploading, so a release is
# visible immediately instead of within the minute.
resource "cloudflare_ruleset" "cache" {
  count       = var.manage_cache_rule ? 1 : 0
  zone_id     = var.zone_id
  name        = "${var.bucket_name}-cache"
  description = "Let the custom panel's bundle expire on its own TTL"
  kind        = "zone"
  phase       = "http_request_cache_settings"

  rules = [{
    ref         = "panel_respect_origin_ttl"
    description = "panel.js: respect the origin's Cache-Control"
    expression  = "(http.host eq \"${var.domain}\")"
    action      = "set_cache_settings"
    action_parameters = {
      cache = true
      edge_ttl = {
        mode = "respect_origin"
      }
      browser_ttl = {
        mode = "respect_origin"
      }
    }
  }]
}
