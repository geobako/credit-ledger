# Logs (KMS-encrypted) and the alarms that page someone. Alarms focus on what threatens money
# or availability, not on resource trivia.

resource "aws_cloudwatch_log_group" "service" {
  for_each          = toset(["lending-api", "card-gateway", "migrate"])
  name              = "/ecs/${local.name}/${each.key}"
  retention_in_days = var.log_retention_days
  kms_key_id        = aws_kms_key.logs.arn
}

resource "aws_cloudwatch_log_group" "flow_logs" {
  name              = "/vpc/${local.name}/flow-logs"
  retention_in_days = 90
  kms_key_id        = aws_kms_key.logs.arn
}

resource "aws_sns_topic" "alarms" {
  name              = "${local.name}-alarms"
  kms_master_key_id = aws_kms_key.alerts.arn
}

resource "aws_sns_topic_subscription" "alarms_email" {
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

# ── Money-integrity alarms (from structured logs) ─────────────────────────────

locals {
  log_alarms = {
    # Hourly reconciliation found the stored numbers disagree with the ledger. Page immediately.
    reconciliation-failed = {
      group       = "lending-api"
      pattern     = "{ $.msg = \"reconciliation found discrepancies\" }"
      description = "Reconciliation found discrepancies between balances and the ledger. See docs/RUNBOOK.md#reconciliation-failed."
    }
    # A fail-closed decline whose compensating reversal could not be completed: a customer may
    # have a hold they never got goods for.
    gateway-reversal-needs-review = {
      group       = "card-gateway"
      pattern     = "{ $.level = \"ERROR\" && $.msg = \"*manual review*\" }"
      description = "A timeout reversal could not be completed. See docs/RUNBOOK.md#timeout-reversal-needs-review."
    }
    # Any unhandled error in the API (ProblemFilter logs these with this message).
    api-unhandled-errors = {
      group       = "lending-api"
      pattern     = "{ $.msg = \"unhandled error\" }"
      description = "The lending API returned 5xx for an unexpected error."
    }
  }
}

resource "aws_cloudwatch_log_metric_filter" "alarm" {
  for_each       = local.log_alarms
  name           = each.key
  log_group_name = aws_cloudwatch_log_group.service[each.value.group].name
  pattern        = each.value.pattern
  metric_transformation {
    name          = each.key
    namespace     = "AcmeCredit/${var.environment}"
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_metric_alarm" "log" {
  for_each            = local.log_alarms
  alarm_name          = "${local.name}-${each.key}"
  alarm_description   = each.value.description
  namespace           = "AcmeCredit/${var.environment}"
  metric_name         = each.key
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
  ok_actions          = [aws_sns_topic.alarms.arn]
}

# ── Availability & latency ─────────────────────────────────────────────────────

resource "aws_cloudwatch_metric_alarm" "network_latency" {
  alarm_name          = "${local.name}-authorization-latency-p99"
  alarm_description   = "Card authorizations are slow at p99. Above ~1.5s the gateway starts declining with 91 (fail closed)."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "TargetResponseTime"
  dimensions          = { LoadBalancer = aws_lb.network.arn_suffix, TargetGroup = aws_lb_target_group.card_gateway.arn_suffix }
  extended_statistic  = "p99"
  period              = 60
  evaluation_periods  = 5
  datapoints_to_alarm = 3
  threshold           = 0.5
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
  ok_actions          = [aws_sns_topic.alarms.arn]
}

resource "aws_cloudwatch_metric_alarm" "target_5xx" {
  for_each = {
    api     = { lb = aws_lb.api.arn_suffix, tg = aws_lb_target_group.lending_api.arn_suffix }
    network = { lb = aws_lb.network.arn_suffix, tg = aws_lb_target_group.card_gateway.arn_suffix }
  }
  alarm_name          = "${local.name}-${each.key}-5xx-rate"
  alarm_description   = "More than 1% of ${each.key} requests fail with 5xx."
  comparison_operator = "GreaterThanThreshold"
  threshold           = 1
  evaluation_periods  = 5
  datapoints_to_alarm = 3
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
  ok_actions          = [aws_sns_topic.alarms.arn]

  metric_query {
    id          = "rate"
    expression  = "100 * errors / MAX([errors, requests])"
    label       = "5xx %"
    return_data = true
  }
  metric_query {
    id = "errors"
    metric {
      namespace   = "AWS/ApplicationELB"
      metric_name = "HTTPCode_Target_5XX_Count"
      dimensions  = { LoadBalancer = each.value.lb, TargetGroup = each.value.tg }
      period      = 60
      stat        = "Sum"
    }
  }
  metric_query {
    id = "requests"
    metric {
      namespace   = "AWS/ApplicationELB"
      metric_name = "RequestCount"
      dimensions  = { LoadBalancer = each.value.lb, TargetGroup = each.value.tg }
      period      = 60
      stat        = "Sum"
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "unhealthy_hosts" {
  for_each = {
    lending-api  = { lb = aws_lb.api.arn_suffix, tg = aws_lb_target_group.lending_api.arn_suffix, min = var.lending_api.min_count }
    card-gateway = { lb = aws_lb.network.arn_suffix, tg = aws_lb_target_group.card_gateway.arn_suffix, min = var.card_gateway.min_count }
  }
  alarm_name          = "${local.name}-${each.key}-healthy-hosts"
  alarm_description   = "Fewer than 2 healthy ${each.key} tasks: one more failure is an outage."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HealthyHostCount"
  dimensions          = { LoadBalancer = each.value.lb, TargetGroup = each.value.tg }
  statistic           = "Minimum"
  period              = 60
  evaluation_periods  = 3
  threshold           = min(2, each.value.min)
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
  ok_actions          = [aws_sns_topic.alarms.arn]
}

# ── Database ───────────────────────────────────────────────────────────────────

resource "aws_cloudwatch_metric_alarm" "db" {
  for_each = {
    cpu = {
      metric = "CPUUtilization", stat = "Average", threshold = 80, op = "GreaterThanThreshold"
      desc   = "Database CPU above 80%."
    }
    free-storage = {
      metric = "FreeStorageSpace", stat = "Minimum", threshold = 10 * 1024 * 1024 * 1024, op = "LessThanThreshold"
      desc   = "Less than 10 GiB of free storage (autoscaling may be at its ceiling)."
    }
    connections = {
      metric = "DatabaseConnections", stat = "Maximum", threshold = 400, op = "GreaterThanThreshold"
      desc   = "Connection count is approaching the instance limit (check pool sizes x task count)."
    }
    replica-lag = {
      metric = "ReplicaLag", stat = "Maximum", threshold = 30, op = "GreaterThanThreshold"
      desc   = "Standby replication lag: failover would take longer."
    }
  }
  alarm_name          = "${local.name}-db-${each.key}"
  alarm_description   = each.value.desc
  namespace           = "AWS/RDS"
  metric_name         = each.value.metric
  dimensions          = { DBInstanceIdentifier = aws_db_instance.main.identifier }
  statistic           = each.value.stat
  period              = 300
  evaluation_periods  = 2
  threshold           = each.value.threshold
  comparison_operator = each.value.op
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
  ok_actions          = [aws_sns_topic.alarms.arn]
}
