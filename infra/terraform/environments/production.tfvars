environment             = "production"
region                  = "eu-west-1"
vpc_cidr                = "10.40.0.0/16"
availability_zone_count = 3
single_nat_gateway      = false

web_domain               = "app.acmecredit.example"
web_certificate_arn      = "arn:aws:acm:us-east-1:222222222222:certificate/00000000-0000-0000-0000-000000000000"
api_origin_domain        = "origin-api.acmecredit.example"
api_certificate_arn      = "arn:aws:acm:eu-west-1:222222222222:certificate/00000000-0000-0000-0000-000000000001"
network_domain           = "network.acmecredit.example"
network_certificate_arn  = "arn:aws:acm:eu-west-1:222222222222:certificate/00000000-0000-0000-0000-000000000002"
network_ca_bundle_s3_uri = "s3://acme-credit-production-trust/card-network-ca.pem"
network_allowed_cidrs    = ["203.0.113.0/24"]

image_tag = "replace-with-git-sha"

# Defaults in variables.tf are the production sizing (3 tasks across 3 AZs, scale to 12).

db_instance_class        = "db.r7g.large"
db_allocated_storage     = 100
db_backup_retention_days = 35

alarm_email        = "oncall@acmecredit.example"
log_retention_days = 400
