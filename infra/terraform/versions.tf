terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
  }

  # Partial configuration: bucket/key/region come from `-backend-config=environments/<env>.s3.tfbackend`.
  # State is encrypted and locked natively in S3 (no DynamoDB table needed since Terraform 1.10).
  backend "s3" {
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project     = "acme-credit"
      Environment = var.environment
      ManagedBy   = "terraform"
      DataClass   = "financial"
    }
  }
}

# CloudFront certificates and CloudFront-scoped WAF must live in us-east-1.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = {
      Project     = "acme-credit"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}
