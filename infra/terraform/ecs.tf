# Two long-running services and one one-off task, all on Fargate in private subnets:
#   lending-api   source of truth for money; behind the API ALB, reachable by the gateway
#   card-gateway  card-network edge; behind the mTLS network ALB
#   migrate       run once per deploy, before the new API version starts (see docs/DEPLOYMENT.md)

resource "aws_ecs_cluster" "main" {
  name = local.name

  setting {
    name  = "containerInsights"
    value = "enhanced"
  }
}

# Private service discovery: the gateway reaches the API at http://lending-api:3000.
resource "aws_service_discovery_http_namespace" "main" {
  name = "${local.name}.internal"
}

# ── IAM ────────────────────────────────────────────────────────────────────────

data "aws_iam_policy_document" "ecs_tasks_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
  }
}

# Execution role: what ECS itself needs to start a task (pull image, write logs, read secrets).
resource "aws_iam_role" "execution" {
  name               = "${local.name}-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "execution_secrets" {
  name = "read-secrets"
  role = aws_iam_role.execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "secretsmanager:GetSecretValue"
        Resource = [for s in aws_secretsmanager_secret.app : s.arn]
      },
      {
        Effect   = "Allow"
        Action   = "kms:Decrypt"
        Resource = aws_kms_key.secrets.arn
      },
    ]
  })
}

# Task roles: what the running code may do. Neither service calls AWS APIs today, so both are
# empty on purpose (and ECS Exec is off: no shell into production tasks).
resource "aws_iam_role" "lending_api" {
  name               = "${local.name}-lending-api"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role" "card_gateway" {
  name               = "${local.name}-card-gateway"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

# ── Task definitions ───────────────────────────────────────────────────────────

locals {
  secret_arn = { for k, s in aws_secretsmanager_secret.app : k => s.arn }

  log_config = { for svc in ["lending-api", "card-gateway", "migrate"] : svc => {
    logDriver = "awslogs"
    options = {
      awslogs-group         = aws_cloudwatch_log_group.service[svc].name
      awslogs-region        = var.region
      awslogs-stream-prefix = svc
    }
  } }

  api_image     = "${aws_ecr_repository.service["lending-api"].repository_url}:${var.image_tag}"
  gateway_image = "${aws_ecr_repository.service["card-gateway"].repository_url}:${var.image_tag}"

  api_environment = [
    { name = "NODE_ENV", value = "production" },
    { name = "PORT", value = "3000" },
    { name = "LOG_LEVEL", value = "info" },
    { name = "WEB_ORIGINS", value = "https://${var.web_domain}" },
    { name = "SANDBOX_ENABLED", value = "false" },
    # Postgres TLS is verified against the RDS CA bundle shipped in the image.
    { name = "NODE_EXTRA_CA_CERTS", value = "/etc/ssl/certs/rds-global-bundle.pem" },
  ]

  api_secrets = [
    { name = "DATABASE_URL", valueFrom = local.secret_arn["database-url"] },
    { name = "WEBHOOK_SECRET", valueFrom = local.secret_arn["webhook-secret"] },
    { name = "GATEWAY_SHARED_SECRET", valueFrom = local.secret_arn["gateway-shared-secret"] },
    { name = "JWT_PRIVATE_KEY", valueFrom = local.secret_arn["jwt-private-key"] },
    { name = "JWT_PUBLIC_KEY", valueFrom = local.secret_arn["jwt-public-key"] },
  ]
}

resource "aws_ecs_task_definition" "lending_api" {
  family                   = "${local.name}-lending-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.lending_api.cpu
  memory                   = var.lending_api.memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.lending_api.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  container_definitions = jsonencode([{
    name                   = "lending-api"
    image                  = local.api_image
    essential              = true
    readonlyRootFilesystem = true
    user                   = "node"
    portMappings           = [{ name = "lending-api", containerPort = 3000, protocol = "tcp", appProtocol = "http" }]
    environment            = local.api_environment
    secrets                = local.api_secrets
    logConfiguration       = local.log_config["lending-api"]
    healthCheck = {
      command     = ["CMD-SHELL", "wget -qO- http://localhost:3000/ready || exit 1"]
      interval    = 15
      timeout     = 5
      retries     = 3
      startPeriod = 20
    }
    # Shutdown hooks drain in-flight transactions before the task stops.
    stopTimeout = 30
  }])
}

resource "aws_ecs_task_definition" "migrate" {
  family                   = "${local.name}-migrate"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.lending_api.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  container_definitions = jsonencode([{
    name                   = "migrate"
    image                  = local.api_image
    essential              = true
    readonlyRootFilesystem = true
    user                   = "node"
    # Forward-only migrations under an advisory lock; never the demo seed.
    command          = ["node", "dist/database/migrate.js"]
    environment      = [{ name = "NODE_EXTRA_CA_CERTS", value = "/etc/ssl/certs/rds-global-bundle.pem" }]
    secrets          = [{ name = "DATABASE_URL", valueFrom = local.secret_arn["database-url"] }]
    logConfiguration = local.log_config["migrate"]
  }])
}

resource "aws_ecs_task_definition" "card_gateway" {
  family                   = "${local.name}-card-gateway"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.card_gateway.cpu
  memory                   = var.card_gateway.memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.card_gateway.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  container_definitions = jsonencode([{
    name                   = "card-gateway"
    image                  = local.gateway_image
    essential              = true
    readonlyRootFilesystem = true
    portMappings           = [{ name = "card-gateway", containerPort = 8081, protocol = "tcp", appProtocol = "http" }]
    environment = [
      { name = "PORT", value = "8081" },
      { name = "LENDING_API_URL", value = "http://lending-api:3000" },
      { name = "AUTH_TIMEOUT_MS", value = "1500" },
    ]
    secrets = [
      { name = "GATEWAY_SHARED_SECRET", valueFrom = local.secret_arn["gateway-shared-secret"] },
      { name = "NETWORK_API_KEY", valueFrom = local.secret_arn["network-api-key"] },
    ]
    logConfiguration = local.log_config["card-gateway"]
    # Long enough for the timeout-reversal queue to drain on shutdown.
    stopTimeout = 60
  }])
}

# ── Services ───────────────────────────────────────────────────────────────────

resource "aws_ecs_service" "lending_api" {
  name                   = "lending-api"
  cluster                = aws_ecs_cluster.main.id
  task_definition        = aws_ecs_task_definition.lending_api.arn
  desired_count          = var.lending_api.desired_count
  launch_type            = "FARGATE"
  enable_execute_command = false
  propagate_tags         = "SERVICE"

  # Rolling deploy that never drops below full capacity, and rolls back by itself if new
  # tasks fail their health checks.
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets         = aws_subnet.private[*].id
    security_groups = [aws_security_group.lending_api.id]
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.lending_api.arn
    container_name   = "lending-api"
    container_port   = 3000
  }

  service_connect_configuration {
    enabled   = true
    namespace = aws_service_discovery_http_namespace.main.arn
    service {
      port_name = "lending-api"
      client_alias {
        port     = 3000
        dns_name = "lending-api"
      }
    }
  }

  lifecycle {
    ignore_changes = [desired_count] # owned by autoscaling
  }
}

resource "aws_ecs_service" "card_gateway" {
  name                               = "card-gateway"
  cluster                            = aws_ecs_cluster.main.id
  task_definition                    = aws_ecs_task_definition.card_gateway.arn
  desired_count                      = var.card_gateway.desired_count
  launch_type                        = "FARGATE"
  propagate_tags                     = "SERVICE"
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets         = aws_subnet.private[*].id
    security_groups = [aws_security_group.card_gateway.id]
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.card_gateway.arn
    container_name   = "card-gateway"
    container_port   = 8081
  }

  # Client-only: discovers lending-api, exposes nothing itself.
  service_connect_configuration {
    enabled   = true
    namespace = aws_service_discovery_http_namespace.main.arn
  }

  lifecycle {
    ignore_changes = [desired_count]
  }
}

# ── Autoscaling ────────────────────────────────────────────────────────────────

locals {
  scaled = {
    lending-api  = { service = aws_ecs_service.lending_api.name, size = var.lending_api }
    card-gateway = { service = aws_ecs_service.card_gateway.name, size = var.card_gateway }
  }
}

resource "aws_appautoscaling_target" "service" {
  for_each           = local.scaled
  service_namespace  = "ecs"
  resource_id        = "service/${aws_ecs_cluster.main.name}/${each.value.service}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = each.value.size.min_count
  max_capacity       = each.value.size.max_count
}

resource "aws_appautoscaling_policy" "cpu" {
  for_each           = local.scaled
  name               = "${each.key}-cpu"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = "ecs"
  resource_id        = aws_appautoscaling_target.service[each.key].resource_id
  scalable_dimension = aws_appautoscaling_target.service[each.key].scalable_dimension

  target_tracking_scaling_policy_configuration {
    target_value       = 55
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}
