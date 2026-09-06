# Private R2 bucket for what guests hand over: today the two faces of each
# passenger's ID.
#
# Deliberately NOT the panel's bucket and deliberately without a custom domain:
# `r2-panel` publishes a JS file to the world, while nothing in here may ever be
# fetched by a browser. There is no public hostname, no CORS rule and no public
# access — the only way in or out is the API task, with the org check in front
# (see apps/api/src/lib/storage.ts). A leaked object key is worth nothing.
#
# The S3 credentials are NOT created here. Cloudflare mints an R2 API token in
# the dashboard (R2 → Manage API tokens → Object Read & Write, this bucket) and
# shows the secret once; it is passed in as a tfvar and lands in SSM as a
# SecureString. Terraform never sees it again.

terraform {
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }
}

variable "bucket_name" { type = string } # "pediatric-docs"
variable "account_id" { type = string }

resource "cloudflare_r2_bucket" "this" {
  account_id = var.account_id
  name       = var.bucket_name
  location   = "ENAM"
}

output "bucket_name" { value = cloudflare_r2_bucket.this.name }
