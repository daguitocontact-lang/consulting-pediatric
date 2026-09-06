# CI deploy role for ONE custom: GitHub Actions (deploy-api.yml) assumes it via
# OIDC — no long-lived AWS keys in the repo's secrets. Same shape as Daguito's
# `github-oidc` module, minus the provider: the account-level OIDC provider for
# github.com already exists (Daguito's Terraform owns it), so it is only read.
#
# Least privilege: push to THIS custom's ECR repo, roll THIS custom's ECS
# service, read its logs. `ecs:*` actions can't be scoped below "*" reliably
# for RegisterTaskDefinition, so the PassRole condition is what keeps the role
# from launching tasks as anyone else.

terraform {
  required_providers {
    aws = { source = "hashicorp/aws" }
  }
}

variable "name" { type = string }        # "pediatric-prod-ci-deploy"
variable "github_repo" { type = string } # "owner/repo"
variable "ecr_repository_arn" { type = string }
variable "ecs_exec_role_arn" { type = string }
variable "ecs_task_role_arn" { type = string }
variable "log_group_arn" { type = string }
variable "allowed_branches" {
  type    = list(string)
  default = ["main"]
}

data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}

# GitHub also mints subs with numeric ids appended (`owner@id/repo@id`) — a
# rename of the org or the repo keeps those working, the plain form does not.
variable "github_repo_ids" {
  type        = string
  default     = ""
  description = "Optional \"owner@ownerId/repo@repoId\" form of github_repo (gh api repos/<owner>/<repo> → .owner.id / .id). Survives renames."
}

locals {
  repos = compact([var.github_repo, var.github_repo_ids])
  subs = flatten([
    for repo in local.repos : [
      for branch in var.allowed_branches : "repo:${repo}:ref:refs/heads/${branch}"
    ]
  ])
}

resource "aws_iam_role" "this" {
  name        = var.name
  description = "GitHub Actions OIDC deploy role for ${var.github_repo} (deploy-api.yml)"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = data.aws_iam_openid_connect_provider.github.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = { "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com" }
        StringLike   = { "token.actions.githubusercontent.com:sub" = local.subs }
      }
    }]
  })

  tags = { Name = var.name }
}

resource "aws_iam_role_policy" "deploy_api" {
  name = "deploy-api"
  role = aws_iam_role.this.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = "ecr:GetAuthorizationToken", Resource = "*" },
      {
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability", "ecr:CompleteLayerUpload", "ecr:InitiateLayerUpload",
          "ecr:PutImage", "ecr:UploadLayerPart", "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer",
          "ecr:DescribeImages",
        ]
        Resource = var.ecr_repository_arn
      },
      {
        Effect = "Allow"
        Action = [
          "ecs:DescribeTaskDefinition", "ecs:RegisterTaskDefinition", "ecs:DescribeServices",
          "ecs:UpdateService", "ecs:RunTask", "ecs:DescribeTasks", "ecs:TagResource",
        ]
        Resource = "*"
      },
      {
        Effect    = "Allow"
        Action    = "iam:PassRole"
        Resource  = [var.ecs_exec_role_arn, var.ecs_task_role_arn]
        Condition = { StringEquals = { "iam:PassedToService" = "ecs-tasks.amazonaws.com" } }
      },
      {
        Effect   = "Allow"
        Action   = ["logs:DescribeLogStreams", "logs:GetLogEvents"]
        Resource = "${var.log_group_arn}:*"
      },
    ]
  })
}

output "role_arn" { value = aws_iam_role.this.arn }
output "role_name" { value = aws_iam_role.this.name }
