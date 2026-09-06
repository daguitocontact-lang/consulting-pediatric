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
