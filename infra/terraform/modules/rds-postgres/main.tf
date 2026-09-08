# Cheapest managed Postgres for a custom: db.t4g.micro (Graviton), single-AZ,
# gp3 20GB, in Daguito's private subnets. Not publicly accessible — reachable
# only from the bastion (migrations) and the custom's ECS task (runtime), both
# by security-group reference.

variable "name" { type = string }        # e.g. "pediatric-prod-db"
variable "db_name" { type = string }     # e.g. "pediatric"
variable "db_username" { type = string } # e.g. "pediatric_app"
variable "vpc_id" { type = string }
variable "subnet_ids" { type = list(string) }
variable "bastion_security_group_id" { type = string }
variable "client_security_group_ids" {
  type        = list(string)
  description = "SGs allowed to connect (the custom's ECS task SG)."
}
variable "ssm_prefix" { type = string } # e.g. "/pediatric/prod/api"
variable "instance_class" {
  type    = string
  default = "db.t4g.micro"
}
variable "allocated_storage" {
  type    = number
  default = 20
}

resource "random_password" "db" {
  length  = 32
  special = false
}

resource "aws_db_subnet_group" "this" {
  name       = var.name
  subnet_ids = var.subnet_ids
  tags       = { Name = var.name }
}

resource "aws_security_group" "db" {
  name        = "${var.name}-sg"
  description = "Postgres access for ${var.name}"
  vpc_id      = var.vpc_id
  tags        = { Name = "${var.name}-sg" }

  lifecycle { ignore_changes = [description] }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# Migrations from the existing Daguito bastion.
resource "aws_security_group_rule" "from_bastion" {
  type                     = "ingress"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  security_group_id        = aws_security_group.db.id
  source_security_group_id = var.bastion_security_group_id
}

# Runtime from the custom's ECS task(s).
resource "aws_security_group_rule" "from_client" {
  count                    = length(var.client_security_group_ids)
  type                     = "ingress"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  security_group_id        = aws_security_group.db.id
  source_security_group_id = var.client_security_group_ids[count.index]
}

resource "aws_db_instance" "this" {
  identifier = var.name
  engine     = "postgres"
  # Major version only: AWS picks the current minor, and a minor bump applied by
  # the maintenance window must not show up as drift. Keep it in step with the
  # Postgres image in infra/docker-compose.dev.yml — dev and prod on different
  # MAJORS is a gap no test can see, because the tests run against dev and the
  # migrations run against this.
  engine_version = "18"
  instance_class = var.instance_class

  db_name  = var.db_name
  username = var.db_username
  password = random_password.db.result

  allocated_storage     = var.allocated_storage
  max_allocated_storage = 100 # autoscale storage, capped
  storage_type          = "gp3"
  storage_encrypted     = true

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.db.id]
  publicly_accessible    = false
  multi_az               = false

  backup_retention_period = 7
  skip_final_snapshot     = true
  # On, and on for the same reason the backups are: what is in here is the
  # clinical record — transcripts, notes, recommendations — and it exists in
  # exactly one place. It costs nothing, and the only thing it blocks is an
  # accidental `terraform destroy` taking the database with it.
  deletion_protection = true
  apply_immediately   = true

  tags = { Name = var.name }
}

# DATABASE_URL for the app → SSM (read by the ECS task as an env var).
resource "aws_ssm_parameter" "database_url" {
  name  = "${var.ssm_prefix}/DATABASE_URL"
  type  = "SecureString"
  value = "postgres://${var.db_username}:${random_password.db.result}@${aws_db_instance.this.address}:5432/${var.db_name}"
}

output "endpoint" { value = aws_db_instance.this.address }
output "security_group_id" { value = aws_security_group.db.id }
output "database_url_ssm_arn" { value = aws_ssm_parameter.database_url.arn }
