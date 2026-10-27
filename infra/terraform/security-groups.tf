# Each hop allows exactly the next hop:
#   CloudFront → api ALB → lending-api → Postgres
#   card network → network ALB (mTLS) → card-gateway → lending-api

data "aws_ec2_managed_prefix_list" "cloudfront" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

resource "aws_security_group" "api_alb" {
  name        = "${local.name}-api-alb"
  description = "API load balancer: HTTPS from CloudFront only"
  vpc_id      = aws_vpc.main.id
}

resource "aws_vpc_security_group_ingress_rule" "api_alb_from_cloudfront" {
  security_group_id = aws_security_group.api_alb.id
  description       = "HTTPS from CloudFront origin-facing ranges"
  prefix_list_id    = data.aws_ec2_managed_prefix_list.cloudfront.id
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_vpc_security_group_egress_rule" "api_alb_to_api" {
  security_group_id            = aws_security_group.api_alb.id
  referenced_security_group_id = aws_security_group.lending_api.id
  ip_protocol                  = "tcp"
  from_port                    = 3000
  to_port                      = 3000
}

resource "aws_security_group" "network_alb" {
  name        = "${local.name}-network-alb"
  description = "Card network entry point: HTTPS with client certificates"
  vpc_id      = aws_vpc.main.id
}

resource "aws_vpc_security_group_ingress_rule" "network_alb_from_network" {
  for_each          = toset(var.network_allowed_cidrs)
  security_group_id = aws_security_group.network_alb.id
  description       = "Card network egress range"
  cidr_ipv4         = each.value
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_vpc_security_group_egress_rule" "network_alb_to_gateway" {
  security_group_id            = aws_security_group.network_alb.id
  referenced_security_group_id = aws_security_group.card_gateway.id
  ip_protocol                  = "tcp"
  from_port                    = 8081
  to_port                      = 8081
}

resource "aws_security_group" "lending_api" {
  name        = "${local.name}-lending-api"
  description = "Lending API tasks"
  vpc_id      = aws_vpc.main.id
}

resource "aws_vpc_security_group_ingress_rule" "api_from_alb" {
  security_group_id            = aws_security_group.lending_api.id
  referenced_security_group_id = aws_security_group.api_alb.id
  ip_protocol                  = "tcp"
  from_port                    = 3000
  to_port                      = 3000
}

resource "aws_vpc_security_group_ingress_rule" "api_from_gateway" {
  security_group_id            = aws_security_group.lending_api.id
  referenced_security_group_id = aws_security_group.card_gateway.id
  ip_protocol                  = "tcp"
  from_port                    = 3000
  to_port                      = 3000
}

resource "aws_vpc_security_group_egress_rule" "api_to_db" {
  security_group_id            = aws_security_group.lending_api.id
  referenced_security_group_id = aws_security_group.database.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}

# No route to the internet is needed today: payment providers call us (webhooks), we never call
# them. If an outbound provider API is added, allow-list it explicitly (or via an egress proxy).
resource "aws_vpc_security_group_egress_rule" "api_https_out" {
  security_group_id = aws_security_group.lending_api.id
  description       = "AWS interface endpoints (ECR, logs, secrets, KMS)"
  cidr_ipv4         = var.vpc_cidr
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_vpc_security_group_egress_rule" "api_to_s3" {
  security_group_id = aws_security_group.lending_api.id
  description       = "ECR image layers via the S3 gateway endpoint"
  prefix_list_id    = aws_vpc_endpoint.s3.prefix_list_id
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_security_group" "card_gateway" {
  name        = "${local.name}-card-gateway"
  description = "Card gateway tasks"
  vpc_id      = aws_vpc.main.id
}

resource "aws_vpc_security_group_ingress_rule" "gateway_from_alb" {
  security_group_id            = aws_security_group.card_gateway.id
  referenced_security_group_id = aws_security_group.network_alb.id
  ip_protocol                  = "tcp"
  from_port                    = 8081
  to_port                      = 8081
}

resource "aws_vpc_security_group_egress_rule" "gateway_to_api" {
  security_group_id            = aws_security_group.card_gateway.id
  referenced_security_group_id = aws_security_group.lending_api.id
  ip_protocol                  = "tcp"
  from_port                    = 3000
  to_port                      = 3000
}

resource "aws_vpc_security_group_egress_rule" "gateway_https_out" {
  security_group_id = aws_security_group.card_gateway.id
  description       = "AWS endpoints (ECR, logs, secrets)"
  cidr_ipv4         = var.vpc_cidr
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_security_group" "database" {
  name        = "${local.name}-database"
  description = "Postgres: lending API (and the migration task) only"
  vpc_id      = aws_vpc.main.id
}

resource "aws_vpc_security_group_ingress_rule" "db_from_api" {
  security_group_id            = aws_security_group.database.id
  referenced_security_group_id = aws_security_group.lending_api.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}

resource "aws_security_group" "endpoints" {
  name        = "${local.name}-vpc-endpoints"
  description = "Interface VPC endpoints"
  vpc_id      = aws_vpc.main.id
}

resource "aws_vpc_security_group_ingress_rule" "endpoints_from_vpc" {
  security_group_id = aws_security_group.endpoints.id
  cidr_ipv4         = var.vpc_cidr
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_vpc_security_group_egress_rule" "gateway_to_s3" {
  security_group_id = aws_security_group.card_gateway.id
  description       = "ECR image layers via the S3 gateway endpoint"
  prefix_list_id    = aws_vpc_endpoint.s3.prefix_list_id
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}
