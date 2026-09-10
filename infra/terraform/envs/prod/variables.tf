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

variable "daguito_stream_api_key" {
  type        = string
  default     = ""
  sensitive   = true
  description = "Account key (dgsk_acc_...) of the Daguito account that owns the consultation flows (realtime-consultation, in-person-consultation, pre-recorded-consultation, consultation-chatbot). The API resolves the flow webhook and mints per-session stream tokens with it; the key never reaches the browser. Stored as an SSM SecureString. Empty = /stream/token and /chat answer 503 and the panel says \"no transcription engine\" — room, hand-written note and assistant thread still work. May be the same key as daguito_api_key if one account owns both."
}

variable "daguito_web_origin" {
  type        = string
  default     = "https://app.daguito.com"
  description = "The only browser origin allowed to load the panel + call the API (CORS)."
}

variable "patient_base_url" {
  type        = string
  default     = ""
  description = "Full url of the patient's page when Daguito serves it under its own domain (e.g. https://app.daguito.com/consulta, or .../consulta/{id} when their router's route is the consultation). Empty = <panel bucket>/consulta, published by this repo's own deploy. Setting it moves the link the doctor copies AND opens CORS for that origin, from one place (apps/api/src/lib/panel-origin.ts)."
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
  default     = "meet.midulabs.com"
  description = "Jitsi server that hosts the consultation rooms. With jitsi_self_hosted this is the name THIS stack provisions and points at its own box, and it has to live in the daguito.com zone. Without it, the legacy product's server. Do NOT leave it empty either way: the fallback is the public meet.jit.si, which holds every joiner in a guest lobby (\"the conference has not yet started because no moderators have yet arrived\") because it only recognises 8x8 accounts as moderators — so the doctor cannot start their own room. It is also not a place for patient data."
}

variable "jitsi_self_hosted" {
  type        = bool
  default     = false
  description = "Run the client's own Jitsi (EC2 + Elastic IP + Let's Encrypt, modules/jitsi) at jitsi_domain instead of borrowing the legacy server. It is the one part of this micro with an inbound security group and a public IP — the media is UDP/10000 and a Cloudflare Tunnel carries TCP — so it is also the one part that costs more than a few dollars: see COST.md. Turning it on also turns the rooms from public to token-gated, because the box gets the JWT module and the API's signing secret."
}

variable "jitsi_api_domain" {
  type        = string
  default     = ""
  description = "Point the API — and so every consultation — at a DIFFERENT Jitsi than the one this stack runs, without tearing that one down: the legacy meet.midulabs.com while something is being sorted out. The box, its DNS and its certificate stay up and keep costing; only the API's env moves, so going back is one apply. Empty = the API uses jitsi_domain, which is the normal case. Whatever this names is treated as anonymous: the room credentials belong to OUR box and are NOT injected, so the API signs no token and joins a public room (which is what the legacy server expects — its own .env carries no JITSI_* at all)."
}

variable "jitsi_instance_type" {
  type        = string
  default     = "t4g.small"
  description = "Graviton. Jitsi forwards media rather than transcoding it, so this is mostly a RAM decision: t4g.small (2 GB + the swap file user_data adds) carries a few concurrent consultations; go t4g.medium when they start overlapping four or five deep."
}

variable "jitsi_letsencrypt_email" {
  type        = string
  default     = ""
  description = "Where Let's Encrypt sends expiry warnings for jitsi_domain. Required when jitsi_self_hosted: without a real certificate the panel cannot load external_api.js from the box at all."
}

variable "jitsi_video_height" {
  type        = number
  default     = 720
  description = "Capture resolution cap on the self-hosted box. The egress lever: a two-person consultation goes peer-to-peer and never touches the server, but the calls that fall back to the relay cost ~$0.14/hour at 720p and about a third of that at 360p. 720 because the paediatrician is LOOKING at the child."
}

variable "jitsi_app_id" {
  type        = string
  default     = ""
  description = "App id the Jitsi JWT module (prosody token_verification) expects as iss/sub/aud. Empty defaults to client_name when jitsi_self_hosted, and otherwise means the rooms are PUBLIC: anyone with the room name may join. Not a secret itself."
}

variable "jitsi_app_secret" {
  type        = string
  default     = ""
  sensitive   = true
  description = "HS256 secret the room tokens are signed with. Stored as an SSM SecureString. Empty = public rooms — except with jitsi_self_hosted, where one is generated and never has to be typed by a human: the API reads it from SSM to sign and the box reads the same parameter to verify."
}
