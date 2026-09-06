# Reuse Daguito's existing prod network via DATA SOURCES — this module creates
# NO networking (no VPC, no NAT, no subnets). The custom's ECS task lands in
# Daguito's PRIVATE subnets and gets egress "for free" through the existing NAT.
# Inbound is never opened: traffic arrives via a Cloudflare Tunnel (dial-out).
#
# Depends only on the `Name`/`Tier` tags Daguito's terraform sets on those
# resources — no cross-state coupling.

variable "daguito_env" {
  type        = string
  default     = "prod"
  description = "Which Daguito environment's VPC to attach into."
}

data "aws_vpc" "daguito" {
  tags = { Name = "daguito-${var.daguito_env}-vpc" }
}

data "aws_subnets" "private" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.daguito.id]
  }
  tags = { Tier = "private" }
}

# Bastion SG — whitelisted on the custom's RDS so we can run migrations via the
# existing bastion (same one documented in Daguito's CLAUDE.md).
data "aws_security_group" "bastion" {
  tags = { Name = "daguito-${var.daguito_env}-bastion-sg" }
}

output "vpc_id" {
  value = data.aws_vpc.daguito.id
}

output "private_subnet_ids" {
  value = data.aws_subnets.private.ids
}

output "bastion_security_group_id" {
  value = data.aws_security_group.bastion.id
}
