# Everything that changes between customs lives here. A new custom = a new
# prod.tfvars; names/tags/resource-group/state-key all derive from client_name.
variable "region" {
  type    = string
  default = "us-east-1"
}

variable "env" {
  type    = string
  default = "prod"
}

variable "client_name" {
  type        = string
  description = "Short slug, e.g. \"pediatric\". Prefixes every resource name/tag."
}

variable "domain" {
  type        = string
  description = "Public API hostname, e.g. \"pediatric-api.daguito.com\" (two levels so the universal *.daguito.com cert covers it)."
}

variable "db_name" {
  type    = string
  default = "pediatric"
}

variable "db_username" {
  type    = string
  default = "pediatric_app"
}

variable "cloudflare_account_id" {
  type = string
}

variable "cloudflare_zone_id" {
  type        = string
  description = "Zone id of daguito.com in Cloudflare."
}

variable "image" {
  type        = string
  description = "Initial ECR image ref (repo:tag) for the first apply; CI rolls new revisions after."
  default     = "public.ecr.aws/docker/library/busybox:latest"
}

variable "daguito_jwt_public_key" {
  type        = string
  description = "Daguito's RS256 PUBLIC key (PEM). The custom verifies panel/agent tokens with it. Public — safe to store."
}

variable "daguito_org_ids" {
  type        = string
  description = "Comma-separated Daguito org ids this custom serves. Not a secret, but REQUIRED: Daguito signs custom-panel tokens for every org with the same key, so this allow-list is what keeps another org's valid token out of this client's data. The API refuses to boot without it. Find it in Daguito: SELECT id FROM public.organizations WHERE settings->'custom'->>'remote_url' IS NOT NULL."
}

variable "daguito_api_base" {
  type        = string
  default     = "https://api.daguito.com"
  description = "Daguito's API root. The custom calls it on boot to register the contact custom fields it needs."
}

variable "daguito_api_key" {
  type        = string
  default     = ""
  sensitive   = true
  description = "Daguito ACCOUNT KEY (dgsk_acc_...) this custom registers its contact fields with. Minted by an org owner (POST /v1/account/api-keys) and bound to that one org; revoke it there, not here. Stored as an SSM SecureString. Empty = skip the registration."
}

variable "r2_access_key_id" {
  type        = string
  default     = ""
  description = "Access key id of the R2 API token that may read/write <client>-docs (Cloudflare dashboard: R2 -> Manage API tokens -> Object Read & Write). Empty = the API keeps documents on the task's disk instead."
}

variable "r2_secret_access_key" {
  type        = string
  default     = ""
  sensitive   = true
  description = "Secret for r2_access_key_id. Shown once by Cloudflare; stored as an SSM SecureString, never in the repo (prod.tfvars is gitignored)."
}

variable "daguito_webhook_secret" {
  type        = string
  default     = ""
  sensitive   = true
  description = "Secret of the pediatric-ticket-resolved webhook subscription (whsec_...). The API verifies x-daguito-signature with it. Shown once when the subscription is created. Empty = the receiver answers 503."
}

variable "daguito_web_origin" {
  type        = string
  default     = "https://app.daguito.com"
  description = "The only browser origin allowed to load the panel + call the API (CORS)."
}

variable "github_repo" {
  type        = string
  description = "GitHub owner/repo whose main branch may assume the CI deploy role (deploy-api.yml)."
}

variable "github_repo_ids" {
  type        = string
  default     = ""
  description = "Optional rename-proof form \"owner@ownerId/repo@repoId\" (gh api repos/<owner>/<repo> → .owner.id / .id)."
}

variable "jitsi_domain" {
  type        = string
  default     = ""
  description = "Jitsi server that hosts the consultation rooms, e.g. \"meet.pediatric.example\". Empty = the public meet.jit.si, which is fine for a pilot and not for patient data."
}

variable "jitsi_app_id" {
  type        = string
  default     = ""
  description = "App id the Jitsi JWT module (prosody token_verification) expects as iss/sub/aud. Empty, together with the secret, means the rooms are PUBLIC: anyone with the room name may join. Not a secret itself."
}

variable "jitsi_app_secret" {
  type        = string
  default     = ""
  sensitive   = true
  description = "HS256 secret the room tokens are signed with. Stored as an SSM SecureString. Empty = public rooms; the API still serves, because this guards a video room and not the client's records."
}
