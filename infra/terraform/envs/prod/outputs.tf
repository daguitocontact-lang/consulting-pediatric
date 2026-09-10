output "ecr_repository_url" {
  value = module.ecr.repository_url
}

output "ecs_cluster" {
  value = module.ecs.cluster_name
}

output "ecs_service" {
  value = module.ecs.service_name
}

output "rds_endpoint" {
  value = module.rds.endpoint
}

output "api_hostname" {
  value = module.cloudflare_tunnel.hostname
}

output "resource_group" {
  value = aws_resourcegroups_group.this.name
}

output "panel_url" {
  value = module.r2_panel.panel_url
}

output "ci_deploy_role_arn" {
  value = module.github_oidc.role_arn
}

# Empty when the client borrows the legacy server (jitsi_self_hosted = false).
output "jitsi_hostname" {
  value = one(module.jitsi[*].hostname)
}

# The address the DNS record points at, and the one the videobridge advertises.
# It outlives the box: rebuilding the instance does not change it.
output "jitsi_public_ip" {
  value = one(module.jitsi[*].public_ip)
}

# For `aws ssm start-session --target <id>` — the box has no SSH key and port 22
# is open to the bastion only.
output "jitsi_instance_id" {
  value = one(module.jitsi[*].instance_id)
}
