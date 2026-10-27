output "web_url" {
  description = "Customer app and operations console."
  value       = "https://${var.web_domain}"
}

output "cloudfront_domain" {
  description = "Point the web_domain DNS record (alias) here."
  value       = aws_cloudfront_distribution.web.domain_name
}

output "api_alb_dns_name" {
  description = "Point the api_origin_domain DNS record (alias) here."
  value       = aws_lb.api.dns_name
}

output "network_alb_dns_name" {
  description = "Point the network_domain DNS record (alias) here; share it with the card network."
  value       = aws_lb.network.dns_name
}

output "ecr_repositories" {
  description = "Where CI pushes images."
  value       = { for k, r in aws_ecr_repository.service : k => r.repository_url }
}

output "web_bucket" {
  description = "Where CI uploads the web build."
  value       = aws_s3_bucket.web.bucket
}

output "migrate_task" {
  description = "Run before each API deploy (see docs/DEPLOYMENT.md)."
  value = {
    cluster         = aws_ecs_cluster.main.name
    task_definition = aws_ecs_task_definition.migrate.family
    subnets         = aws_subnet.private[*].id
    security_groups = [aws_security_group.lending_api.id]
  }
}

output "database_endpoint" {
  description = "Private RDS endpoint (reachable only from the API's security group)."
  value       = aws_db_instance.main.address
}
