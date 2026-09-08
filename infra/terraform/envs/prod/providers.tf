# default_tags stamp EVERY resource so a new project stays organized across
# dozens of customs: filter/cost-split by Client, see them in a Resource Group.
provider "aws" {
  region = var.region
  default_tags {
    tags = {
      Project   = "daguito"
      Client    = var.client_name
      Env       = var.env
      ManagedBy = "terraform"
      Repo      = "daguitocontact-lang/consulting-pediatric"
    }
  }
}

# Reads CLOUDFLARE_API_TOKEN from the environment (same convention as Daguito).
provider "cloudflare" {}
