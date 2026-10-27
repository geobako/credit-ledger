variable "environment" {
  description = "Deployment environment name (staging, production)."
  type        = string

  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be staging or production."
  }
}

variable "region" {
  description = "Primary AWS region."
  type        = string
  default     = "eu-west-1"
}

variable "vpc_cidr" {
  description = "CIDR block of the VPC."
  type        = string
  default     = "10.40.0.0/16"
}

variable "availability_zone_count" {
  description = "AZs to spread subnets, NAT gateways and tasks across."
  type        = number
  default     = 3

  validation {
    condition     = var.availability_zone_count >= 2 && var.availability_zone_count <= 3
    error_message = "Use 2 or 3 availability zones."
  }
}

variable "single_nat_gateway" {
  description = "One NAT gateway instead of one per AZ (cheaper, but an AZ outage cuts egress). Staging only."
  type        = bool
  default     = false
}

# ── Domains & certificates ─────────────────────────────────────────────────────

variable "web_domain" {
  description = "Public hostname of the web app (served by CloudFront), e.g. app.acmecredit.com."
  type        = string
}

variable "web_certificate_arn" {
  description = "ACM certificate in us-east-1 covering web_domain (CloudFront requirement)."
  type        = string
}

variable "api_origin_domain" {
  description = "Hostname of the API load balancer, used only by CloudFront as its origin, e.g. origin-api.acmecredit.com."
  type        = string
}

variable "api_certificate_arn" {
  description = "Regional ACM certificate covering api_origin_domain."
  type        = string
}

variable "network_domain" {
  description = "Hostname the card network connects to, e.g. network.acmecredit.com."
  type        = string
}

variable "network_certificate_arn" {
  description = "Regional ACM certificate covering network_domain."
  type        = string
}

variable "network_ca_bundle_s3_uri" {
  description = "s3://bucket/key of the card network's CA bundle (PEM). Only clients holding a certificate it signed can connect (mutual TLS)."
  type        = string
}

variable "network_allowed_cidrs" {
  description = "Source ranges of the card network's egress (defence in depth on top of mutual TLS)."
  type        = list(string)
}

# ── Workloads ──────────────────────────────────────────────────────────────────

variable "image_tag" {
  description = "Immutable image tag (git SHA) deployed for every service."
  type        = string
}

variable "lending_api" {
  description = "Sizing of the lending API service."
  type = object({
    cpu           = number
    memory        = number
    desired_count = number
    min_count     = number
    max_count     = number
  })
  default = {
    cpu           = 1024
    memory        = 2048
    desired_count = 3
    min_count     = 3
    max_count     = 12
  }
}

variable "card_gateway" {
  description = "Sizing of the card gateway service."
  type = object({
    cpu           = number
    memory        = number
    desired_count = number
    min_count     = number
    max_count     = number
  })
  default = {
    cpu           = 512
    memory        = 1024
    desired_count = 3
    min_count     = 3
    max_count     = 12
  }
}

# ── Database ───────────────────────────────────────────────────────────────────

variable "db_instance_class" {
  description = "RDS instance class."
  type        = string
  default     = "db.r7g.large"
}

variable "db_allocated_storage" {
  description = "Initial storage (GiB); autoscaling grows it up to 10x."
  type        = number
  default     = 100
}

variable "db_backup_retention_days" {
  description = "Point-in-time recovery window."
  type        = number
  default     = 35
}

# ── Operations ─────────────────────────────────────────────────────────────────

variable "alarm_email" {
  description = "Address subscribed to the alarm topic (wire PagerDuty/Opsgenie to the same topic)."
  type        = string
}

variable "log_retention_days" {
  description = "CloudWatch log retention. Audit-relevant data lives in the database, not in logs."
  type        = number
  default     = 400
}
