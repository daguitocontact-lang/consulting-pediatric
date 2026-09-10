# Jitsi Meet, self-hosted: one EC2 box with a public IP, in Daguito's PUBLIC
# subnets. It is the only piece of this micro that is not behind a Cloudflare
# Tunnel, and it cannot be: the media is UDP/10000 and a tunnel carries TCP.
# That is also why it is the only piece with an inbound security group and the
# only one that pays for an Elastic IP.
#
# One instance, no ASG, no load balancer, and that is on purpose: a Jitsi that
# scales horizontally means several videobridges plus a shared prosody, which is
# a different (and much more expensive) deployment. A clinic doing a handful of
# concurrent consultations fits on one t4g.small — and if it stops fitting, the
# lever is `instance_type`, not a second box.
#
# NOT on Spot, unlike the API: a reclaim mid-consultation drops the doctor and
# the parent out of the room, and there is nothing to fail over to.
#
# The box is STATELESS. Everything it needs is in user_data, so a broken one is
# replaced rather than repaired (`terraform taint`, or just edit user_data —
# `user_data_replace_on_change` rebuilds it). The Elastic IP survives the
# replacement, so DNS and the issued certificate keep pointing somewhere real.

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.70"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }
}

variable "name" { type = string }     # "pediatric-prod-jitsi"
variable "hostname" { type = string } # "pediatric-meet.daguito.com"
variable "vpc_id" { type = string }
variable "subnet_id" {
  type        = string
  description = "A PUBLIC subnet (route to the IGW). Private would give the box egress through the NAT but no reachable UDP port, and the room would connect signalling and then carry no audio or video."
}
variable "zone_id" { type = string } # daguito.com
variable "region" { type = string }

variable "instance_type" {
  type        = string
  default     = "t4g.small"
  description = "ARM/Graviton. Jitsi forwards media, it does not transcode, so this is a RAM decision more than a CPU one: 2 GB is enough for a few concurrent consultations with the swap file user_data adds. Go t4g.medium when consultations start overlapping four or five deep."
}

variable "volume_size" {
  type    = number
  default = 20
}

variable "app_id" {
  type        = string
  description = "iss/sub/aud the prosody token_verification module accepts. Must equal the API's JITSI_APP_ID — the API signs, this box verifies."
}

variable "app_secret_ssm_name" {
  type        = string
  description = "SSM SecureString holding the HS256 room-signing secret. The box READS it at boot; it is deliberately not in user_data, which is plain text to anyone holding ec2:DescribeInstanceAttribute."
}

variable "app_secret_ssm_arn" { type = string }

variable "letsencrypt_email" {
  type        = string
  description = "Where Let's Encrypt sends expiry warnings. Required: the certificate is what makes the panel able to load external_api.js at all."
}

variable "ssh_source_security_group_id" {
  type        = string
  description = "Bastion SG. Port 22 is open to it and to nothing else — the normal way in is SSM Session Manager, which needs no inbound rule at all."
}

variable "video_height" {
  type        = number
  default     = 720
  description = "Capture resolution cap. This is the egress lever: a 1-on-1 consultation goes peer-to-peer and never touches this box, but the calls that fall back to the relay cost about $0.14/hour at 720p and a third of that at 360p. 720 because a paediatrician is LOOKING at the child."
}

# Canonical's published AMI id, resolved at plan time. arm64 to match t4g.
data "aws_ssm_parameter" "ubuntu" {
  name = "/aws/service/canonical/ubuntu/server/24.04/stable/current/arm64/hvm/ebs-gp3/ami-id"
}

# ── The public IP, allocated before the box ──────────────────────────
# Separate from the instance so it outlives it: user_data bakes this address in
# (the videobridge has to ADVERTISE it — see the NAT harvester below) and the
# DNS record points at it, so a rebuilt box comes back at the same address with
# the same certificate still valid.
resource "aws_eip" "this" {
  domain = "vpc"
  tags   = { Name = var.name }
}

# ── DNS: A record, NOT proxied ───────────────────────────────────────
# Grey cloud on purpose. Cloudflare's proxy would break this twice: it does not
# carry UDP/10000, so the media would have nowhere to go, and the box issues its
# own Let's Encrypt certificate over port 80. The origin IP being public is not
# a leak here — it is the point.
resource "cloudflare_dns_record" "this" {
  zone_id = var.zone_id
  name    = var.hostname
  type    = "A"
  content = aws_eip.this.public_ip
  proxied = false
  ttl     = 60

  lifecycle {
    precondition {
      condition     = endswith(var.hostname, ".daguito.com")
      error_message = "jitsi_domain has to be a name in the daguito.com zone when jitsi_self_hosted is on — this module creates its DNS record. Leaving it at meet.midulabs.com means you meant to keep using the legacy server: set jitsi_self_hosted = false."
    }
  }
}

# ── Security group ───────────────────────────────────────────────────
resource "aws_security_group" "this" {
  name        = "${var.name}-sg"
  description = "Jitsi Meet ${var.hostname}"
  vpc_id      = var.vpc_id
  tags        = { Name = "${var.name}-sg" }

  lifecycle { ignore_changes = [description] }
}

# HTTP: the Let's Encrypt challenge and the redirect to 443. Closing it after
# the first issue would break renewal 60 days later, silently.
resource "aws_security_group_rule" "http" {
  type              = "ingress"
  from_port         = 80
  to_port           = 80
  protocol          = "tcp"
  cidr_blocks       = ["0.0.0.0/0"]
  security_group_id = aws_security_group.this.id
  description       = "HTTP (ACME challenge + redirect)"
}

# HTTPS: the web app, the XMPP websocket AND the TURN fallback (jitsi's nginx
# multiplexes coturn onto 443 by ALPN), which is what gets a doctor behind a
# hospital firewall into the room.
resource "aws_security_group_rule" "https" {
  type              = "ingress"
  from_port         = 443
  to_port           = 443
  protocol          = "tcp"
  cidr_blocks       = ["0.0.0.0/0"]
  security_group_id = aws_security_group.this.id
  description       = "HTTPS (web, XMPP websocket, TURN/TLS fallback)"
}

# The media itself. Everything else can be right and the room stays silent if
# this one is missing.
resource "aws_security_group_rule" "media" {
  type              = "ingress"
  from_port         = 10000
  to_port           = 10000
  protocol          = "udp"
  cidr_blocks       = ["0.0.0.0/0"]
  security_group_id = aws_security_group.this.id
  description       = "Videobridge RTP/UDP"
}

# ── TURN ─────────────────────────────────────────────────────────────
# The fallback path for the media, and leaving it shut is the most expensive
# kind of mistake this deployment can make: everything LOOKS right — the room
# opens, the token verifies, the participant list fills in — and not one packet
# of audio or video moves, because the only way in was UDP/10000 and this
# network does not let UDP out. A hospital's wifi, a corporate laptop and some
# mobile carriers all do exactly that.
#
# These are not a guess: prosody's `external_services` hands the browser these
# three, by name and port, and every one of them has to be reachable or the
# browser is being told to use a door that is bricked up.
#
#   stun:  <domain>:3478            udp
#   turn:  <domain>:3478?transport=udp
#   turns: <domain>:5349?transport=tcp   ← the one that saves the hard networks
#
# (coturn is built with `no-tcp`, so 3478 is UDP only and there is no point in
# opening its TCP twin.)
resource "aws_security_group_rule" "turn_udp" {
  type              = "ingress"
  from_port         = 3478
  to_port           = 3478
  protocol          = "udp"
  cidr_blocks       = ["0.0.0.0/0"]
  security_group_id = aws_security_group.this.id
  description       = "STUN/TURN over UDP"
}

resource "aws_security_group_rule" "turns_tcp" {
  type              = "ingress"
  from_port         = 5349
  to_port           = 5349
  protocol          = "tcp"
  cidr_blocks       = ["0.0.0.0/0"]
  security_group_id = aws_security_group.this.id
  description       = "TURN over TLS: the fallback when UDP is blocked"
}

resource "aws_security_group_rule" "ssh_from_bastion" {
  type                     = "ingress"
  from_port                = 22
  to_port                  = 22
  protocol                 = "tcp"
  source_security_group_id = var.ssh_source_security_group_id
  security_group_id        = aws_security_group.this.id
  description              = "SSH from the Daguito bastion only"
}

resource "aws_security_group_rule" "egress" {
  type              = "egress"
  from_port         = 0
  to_port           = 0
  protocol          = "-1"
  cidr_blocks       = ["0.0.0.0/0"]
  security_group_id = aws_security_group.this.id
}

# ── Instance role: read the room secret, and be reachable by SSM ─────
data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "this" {
  name               = var.name
  assume_role_policy = data.aws_iam_policy_document.assume.json
}

# Session Manager: a root shell on the box without opening 22 to anything and
# without a key pair to lose.
resource "aws_iam_role_policy_attachment" "ssm_core" {
  role       = aws_iam_role.this.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy" "read_secret" {
  name = "${var.name}-read-app-secret"
  role = aws_iam_role.this.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["ssm:GetParameter", "ssm:GetParameters"]
      Resource = [var.app_secret_ssm_arn]
    }]
  })
}

resource "aws_iam_instance_profile" "this" {
  name = var.name
  role = aws_iam_role.this.name
}

# ── The box ──────────────────────────────────────────────────────────
resource "aws_instance" "this" {
  ami                    = data.aws_ssm_parameter.ubuntu.value
  instance_type          = var.instance_type
  subnet_id              = var.subnet_id
  vpc_security_group_ids = [aws_security_group.this.id]
  iam_instance_profile   = aws_iam_instance_profile.this.name

  # Needed for the boot itself: user_data downloads ~400 MB of packages before
  # the Elastic IP is associated, and this subnet's own auto-assigned address is
  # what carries that.
  associate_public_ip_address = true

  metadata_options {
    http_tokens   = "required" # IMDSv2
    http_endpoint = "enabled"
  }

  root_block_device {
    volume_type = "gp3"
    volume_size = var.volume_size
    encrypted   = true
  }

  user_data = templatefile("${path.module}/user-data.sh", {
    hostname     = var.hostname
    app_id       = var.app_id
    secret_param = var.app_secret_ssm_name
    region       = var.region
    le_email     = var.letsencrypt_email
    public_ip    = aws_eip.this.public_ip
    video_height = var.video_height
  })

  # The box holds no state, so a config change is a rebuild, not a patch: this
  # keeps what is running equal to what is in the repo. Costs ~4 minutes of
  # downtime, which is why it belongs outside consultation hours.
  user_data_replace_on_change = true

  lifecycle {
    precondition {
      condition     = var.letsencrypt_email != ""
      error_message = "jitsi_letsencrypt_email is required: the installer's certificate script prompts for it, and it is where the expiry warnings land."
    }
  }

  tags = { Name = var.name }
}

resource "aws_eip_association" "this" {
  instance_id   = aws_instance.this.id
  allocation_id = aws_eip.this.id
}

output "hostname" { value = var.hostname }
output "public_ip" { value = aws_eip.this.public_ip }
output "instance_id" { value = aws_instance.this.id }
output "security_group_id" { value = aws_security_group.this.id }
