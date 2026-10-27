# ── API: only CloudFront can reach it ──────────────────────────────────────────
# Network-level: the security group admits CloudFront's origin-facing ranges only.
# Application-level: requests must carry the secret X-Origin-Verify header CloudFront adds, so
# another CloudFront distribution cannot be pointed at this origin.

resource "aws_s3_bucket" "alb_logs" {
  bucket        = "${local.name}-alb-logs-${local.account_id}"
  force_destroy = !local.is_production
}

resource "aws_s3_bucket_public_access_block" "alb_logs" {
  bucket                  = aws_s3_bucket.alb_logs.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

#trivy:ignore:AVD-AWS-0132 ALB log delivery only supports SSE-S3 (AES256), not SSE-KMS.
resource "aws_s3_bucket_server_side_encryption_configuration" "alb_logs" {
  bucket = aws_s3_bucket.alb_logs.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256" # ALB log delivery does not support SSE-KMS
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "alb_logs" {
  bucket = aws_s3_bucket.alb_logs.id
  rule {
    id     = "expire"
    status = "Enabled"
    filter {}
    expiration {
      days = var.log_retention_days
    }
  }
}

resource "aws_s3_bucket_policy" "alb_logs" {
  bucket = aws_s3_bucket.alb_logs.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "logdelivery.elasticloadbalancing.amazonaws.com" }
      Action    = "s3:PutObject"
      Resource  = "${aws_s3_bucket.alb_logs.arn}/*"
    }]
  })
}

#trivy:ignore:AVD-AWS-0053 Public by design, but only CloudFront can reach it (prefix-list SG + secret origin header).
resource "aws_lb" "api" {
  name                       = "${local.name}-api"
  load_balancer_type         = "application"
  internal                   = false
  subnets                    = aws_subnet.public[*].id
  security_groups            = [aws_security_group.api_alb.id]
  drop_invalid_header_fields = true
  enable_deletion_protection = local.is_production

  access_logs {
    bucket  = aws_s3_bucket.alb_logs.id
    prefix  = "api"
    enabled = true
  }
}

resource "aws_lb_target_group" "lending_api" {
  name                 = "${local.name}-api"
  port                 = 3000
  protocol             = "HTTP"
  target_type          = "ip"
  vpc_id               = aws_vpc.main.id
  deregistration_delay = 30

  health_check {
    path                = "/ready"
    matcher             = "200"
    interval            = 10
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener" "api_https" {
  load_balancer_arn = aws_lb.api.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.api_certificate_arn

  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "Forbidden"
      status_code  = "403"
    }
  }
}

resource "aws_lb_listener_rule" "api_from_cloudfront" {
  listener_arn = aws_lb_listener.api_https.arn
  priority     = 10

  condition {
    http_header {
      http_header_name = "X-Origin-Verify"
      values           = [random_password.origin_verify.result]
    }
  }

  # Only the public API. /metrics, /docs and health probes stay inside the VPC.
  condition {
    path_pattern {
      values = ["/v1/*"]
    }
  }

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.lending_api.arn
  }
}

# ── Card network: mutual TLS ───────────────────────────────────────────────────
# The card network presents a client certificate signed by its CA; the ALB rejects the TLS
# handshake otherwise. The gateway additionally checks its network API key.

resource "aws_lb_trust_store" "card_network" {
  name                             = "${local.name}-card-network"
  ca_certificates_bundle_s3_bucket = regex("^s3://([^/]+)/(.+)$", var.network_ca_bundle_s3_uri)[0]
  ca_certificates_bundle_s3_key    = regex("^s3://([^/]+)/(.+)$", var.network_ca_bundle_s3_uri)[1]
}

#trivy:ignore:AVD-AWS-0053 The card network connects over the internet; mutual TLS + source CIDR allow-list.
resource "aws_lb" "network" {
  name                       = "${local.name}-net"
  load_balancer_type         = "application"
  internal                   = false
  subnets                    = aws_subnet.public[*].id
  security_groups            = [aws_security_group.network_alb.id]
  drop_invalid_header_fields = true
  enable_deletion_protection = local.is_production

  access_logs {
    bucket  = aws_s3_bucket.alb_logs.id
    prefix  = "network"
    enabled = true
  }
}

resource "aws_lb_target_group" "card_gateway" {
  name                 = "${local.name}-gw"
  port                 = 8081
  protocol             = "HTTP"
  target_type          = "ip"
  vpc_id               = aws_vpc.main.id
  deregistration_delay = 60

  health_check {
    path                = "/readyz"
    matcher             = "200"
    interval            = 10
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener" "network_https" {
  load_balancer_arn = aws_lb.network.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.network_certificate_arn

  mutual_authentication {
    mode            = "verify"
    trust_store_arn = aws_lb_trust_store.card_network.arn
  }

  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "Not Found"
      status_code  = "404"
    }
  }
}

# Only the network message endpoints; /debug/vars and probes are not exposed to the network.
resource "aws_lb_listener_rule" "network_messages" {
  listener_arn = aws_lb_listener.network_https.arn
  priority     = 10

  condition {
    path_pattern {
      values = ["/v1/authorizations", "/v1/authorizations/*"]
    }
  }

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.card_gateway.arn
  }
}
