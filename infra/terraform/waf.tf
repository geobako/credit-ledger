# Edge protection in front of everything customers and payment-provider webhooks reach.
# CloudFront-scoped, hence created in us-east-1.

resource "aws_wafv2_web_acl" "edge" {
  provider = aws.us_east_1
  name     = "${local.name}-edge"
  scope    = "CLOUDFRONT"

  default_action {
    allow {}
  }

  # Managed rule groups: OWASP-style common attacks, known-bad inputs, bad IP reputation.
  dynamic "rule" {
    for_each = {
      AWSManagedRulesCommonRuleSet          = 10
      AWSManagedRulesKnownBadInputsRuleSet  = 20
      AWSManagedRulesAmazonIpReputationList = 30
    }
    content {
      name     = rule.key
      priority = rule.value
      override_action {
        none {}
      }
      statement {
        managed_rule_group_statement {
          vendor_name = "AWS"
          name        = rule.key
        }
      }
      visibility_config {
        cloudwatch_metrics_enabled = true
        metric_name                = rule.key
        sampled_requests_enabled   = true
      }
    }
  }

  # Sign-in and registration: tight per-IP budget at the edge (the API enforces its own too).
  rule {
    name     = "auth-rate-limit"
    priority = 40
    action {
      block {}
    }
    statement {
      rate_based_statement {
        limit                 = 100 # per 5 minutes per IP
        aggregate_key_type    = "IP"
        evaluation_window_sec = 300
        scope_down_statement {
          byte_match_statement {
            search_string         = "/api/v1/auth/"
            positional_constraint = "STARTS_WITH"
            field_to_match {
              uri_path {}
            }
            text_transformation {
              priority = 0
              type     = "LOWERCASE"
            }
          }
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "auth-rate-limit"
      sampled_requests_enabled   = true
    }
  }

  # Everything else: generous per-IP ceiling against floods.
  rule {
    name     = "global-rate-limit"
    priority = 50
    action {
      block {}
    }
    statement {
      rate_based_statement {
        limit              = 3000
        aggregate_key_type = "IP"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "global-rate-limit"
      sampled_requests_enabled   = true
    }
  }

  # Never from the internet: the sandbox simulator (disabled in deployed environments anyway)
  # and the gateway-only network API (HMAC-signed anyway). Defence in depth for both.
  rule {
    name     = "block-internal-paths"
    priority = 5
    action {
      block {}
    }
    statement {
      or_statement {
        dynamic "statement" {
          for_each = ["/api/v1/sandbox/", "/api/v1/network/"]
          content {
            byte_match_statement {
              search_string         = statement.value
              positional_constraint = "STARTS_WITH"
              field_to_match {
                uri_path {}
              }
              text_transformation {
                priority = 0
                type     = "NORMALIZE_PATH"
              }
              text_transformation {
                priority = 1
                type     = "LOWERCASE"
              }
            }
          }
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "block-internal-paths"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${local.name}-edge"
    sampled_requests_enabled   = true
  }
}
