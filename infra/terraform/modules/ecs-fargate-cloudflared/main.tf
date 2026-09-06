# ECS Fargate service for the custom's API, exposed through a Cloudflare Tunnel
# (a `cloudflared` sidecar dials OUT — no ALB, no public IP, no inbound rules).
# Runs on FARGATE_SPOT for cost. ARM64.

variable "name" { type = string }         # "pediatric-prod-api"
variable "cluster_name" { type = string } # "pediatric-prod"
variable "image" { type = string }        # ECR repo:tag
variable "region" { type = string }
variable "vpc_id" { type = string }
variable "subnet_ids" { type = list(string) }
variable "container_port" {
  type    = number
  default = 8080
}
variable "cpu" {
  type    = number
  default = 256
}
variable "memory" {
  type    = number
  default = 512
}
variable "tunnel_token_ssm_arn" { type = string }
variable "env" {
  type    = map(string)
  default = {}
}
variable "secret_ssm_arns" {
  type        = map(string)
  description = "Container env var name -> SSM parameter ARN (injected as secrets)."
  default     = {}
}

# ── Cluster (dedicated, free; Spot for cost) ─────────────────────────
resource "aws_ecs_cluster" "this" {
  name = var.cluster_name
  tags = { Name = var.cluster_name }
}

resource "aws_ecs_cluster_capacity_providers" "this" {
  cluster_name       = aws_ecs_cluster.this.name
  capacity_providers = ["FARGATE_SPOT", "FARGATE"]
  default_capacity_provider_strategy {
    capacity_provider = "FARGATE_SPOT"
    weight            = 1
    base              = 1
  }
}

# ── Task SG: NO inbound (tunnel dials out); egress all ───────────────
resource "aws_security_group" "task" {
  name        = "${var.name}-task-sg"
  description = "Fargate task for ${var.name} (outbound only)"
  vpc_id      = var.vpc_id
  tags        = { Name = "${var.name}-task-sg" }
  lifecycle { ignore_changes = [description] }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_cloudwatch_log_group" "this" {
  name              = "/ecs/${var.cluster_name}/api"
  retention_in_days = 30
}

# ── IAM: execution role (pull image, read secrets, write logs) ───────
data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "exec" {
  name               = "${var.name}-exec"
  assume_role_policy = data.aws_iam_policy_document.assume.json
}

resource "aws_iam_role_policy_attachment" "exec_managed" {
  role       = aws_iam_role.exec.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Read exactly the SSM secrets this task uses.
resource "aws_iam_role_policy" "exec_secrets" {
  name = "${var.name}-secrets"
  role = aws_iam_role.exec.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["ssm:GetParameters", "ssm:GetParameter"]
      Resource = concat([var.tunnel_token_ssm_arn], values(var.secret_ssm_arns))
    }]
  })
}

resource "aws_iam_role" "task" {
  name               = "${var.name}-task"
  assume_role_policy = data.aws_iam_policy_document.assume.json
}

# ── Task definition: api + cloudflared sidecar ───────────────────────
resource "aws_ecs_task_definition" "this" {
  family                   = var.name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = aws_iam_role.exec.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    cpu_architecture        = "ARM64"
    operating_system_family = "LINUX"
  }

  container_definitions = jsonencode([
    {
      name         = "api"
      image        = var.image
      essential    = true
      portMappings = [{ containerPort = var.container_port, protocol = "tcp" }]
      environment  = [for k, v in var.env : { name = k, value = v }]
      secrets      = [for k, arn in var.secret_ssm_arns : { name = k, valueFrom = arn }]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.this.name
          "awslogs-region"        = var.region
          "awslogs-stream-prefix" = "api"
        }
      }
      # No container healthCheck: the oven/bun image has no wget/curl and a bun
      # -e probe proved flaky, cycling the task and dropping the tunnel. Liveness
      # is still enforced — if the api process exits, this essential container
      # stops and ECS restarts the task. App-level health is exposed at /health.
    },
    {
      name      = "cloudflared"
      image     = "cloudflare/cloudflared:latest"
      essential = true
      command   = ["tunnel", "--no-autoupdate", "run"]
      secrets   = [{ name = "TUNNEL_TOKEN", valueFrom = var.tunnel_token_ssm_arn }]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.this.name
          "awslogs-region"        = var.region
          "awslogs-stream-prefix" = "cloudflared"
        }
      }
    }
  ])
}

resource "aws_ecs_service" "this" {
  name            = var.name
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.this.arn
  desired_count   = 1

  capacity_provider_strategy {
    capacity_provider = "FARGATE_SPOT"
    weight            = 1
    base              = 1
  }

  enable_execute_command = true

  network_configuration {
    subnets          = var.subnet_ids
    security_groups  = [aws_security_group.task.id]
    assign_public_ip = false
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  # The image tag changes out-of-band (CI rolls a new task def revision).
  lifecycle { ignore_changes = [task_definition] }
}

output "task_security_group_id" { value = aws_security_group.task.id }
output "cluster_name" { value = aws_ecs_cluster.this.name }
output "service_name" { value = aws_ecs_service.this.name }
output "exec_role_arn" { value = aws_iam_role.exec.arn }
output "task_role_arn" { value = aws_iam_role.task.arn }
output "log_group_arn" { value = aws_cloudwatch_log_group.this.arn }
