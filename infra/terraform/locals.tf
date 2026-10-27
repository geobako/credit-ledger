data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_caller_identity" "current" {}

data "aws_region" "current" {}

locals {
  name       = "acme-credit-${var.environment}"
  azs        = slice(data.aws_availability_zones.available.names, 0, var.availability_zone_count)
  account_id = data.aws_caller_identity.current.account_id

  # /20 per subnet tier per AZ: public (ALBs, NAT), private (tasks), data (RDS, no internet route).
  public_subnets  = [for i, _ in local.azs : cidrsubnet(var.vpc_cidr, 4, i)]
  private_subnets = [for i, _ in local.azs : cidrsubnet(var.vpc_cidr, 4, i + 4)]
  data_subnets    = [for i, _ in local.azs : cidrsubnet(var.vpc_cidr, 4, i + 8)]

  is_production = var.environment == "production"
}
