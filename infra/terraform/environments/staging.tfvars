environment             = "staging"
region                  = "eu-west-1"
vpc_cidr                = "10.41.0.0/16"
availability_zone_count = 2
single_nat_gateway      = true

web_domain               = "app.staging.acmecredit.example"
web_certificate_arn      = "arn:aws:acm:us-east-1:111111111111:certificate/00000000-0000-0000-0000-000000000000"
api_origin_domain        = "origin-api.staging.acmecredit.example"
api_certificate_arn      = "arn:aws:acm:eu-west-1:111111111111:certificate/00000000-0000-0000-0000-000000000001"
network_domain           = "network.staging.acmecredit.example"
network_certificate_arn  = "arn:aws:acm:eu-west-1:111111111111:certificate/00000000-0000-0000-0000-000000000002"
network_ca_bundle_s3_uri = "s3://acme-credit-staging-trust/card-network-ca.pem"
network_allowed_cidrs    = ["198.51.100.0/24"]

image_tag = "replace-with-git-sha"

lending_api  = { cpu = 512, memory = 1024, desired_count = 2, min_count = 2, max_count = 4 }
card_gateway = { cpu = 256, memory = 512, desired_count = 2, min_count = 2, max_count = 4 }

db_instance_class        = "db.t4g.medium"
db_allocated_storage     = 20
db_backup_retention_days = 7

alarm_email        = "oncall-staging@acmecredit.example"
log_retention_days = 30
