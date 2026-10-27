# Infrastructure (AWS, Terraform)

The production deployment of Acme Credit. Design rationale is in
[ADR 0007](../../docs/adr/0007-aws-ecs-fargate-and-rds.md); the procedures (first apply,
releases, rollbacks, secrets, DR) are in [DEPLOYMENT.md](../../docs/DEPLOYMENT.md).

| File                        | What                                                                                                     |
| --------------------------- | -------------------------------------------------------------------------------------------------------- |
| `versions.tf`               | Terraform/provider versions, S3 backend (native locking), providers (incl. us-east-1 for CloudFront/WAF) |
| `variables.tf`, `locals.tf` | Inputs and derived values (subnet plan)                                                                  |
| `network.tf`                | VPC over 2–3 AZs: public / private / data tiers, NAT per AZ, VPC endpoints, flow logs                    |
| `security-groups.tf`        | One security group per hop, each admitting exactly the previous hop                                      |
| `kms.tf`                    | Customer-managed keys per data class (database, secrets, logs, alerts), rotation on                      |
| `secrets.tf`                | Generated secrets (webhook, gateway, network key, JWT key pair, DB URL) in Secrets Manager               |
| `database.tf`               | RDS Postgres 17 Multi-AZ, encrypted, TLS-only, PITR, deletion protection, Performance Insights           |
| `ecr.tf`                    | Image repositories: immutable tags, scan on push                                                         |
| `ecs.tf`                    | Fargate cluster, Service Connect, task definitions (API, gateway, migrate), services, autoscaling        |
| `load-balancers.tf`         | API ALB (CloudFront-only, `/v1/*` only) and network ALB (mutual TLS)                                     |
| `web.tf`                    | Private S3 + CloudFront (SPA + same-origin `/api` proxy), security headers                               |
| `waf.tf`                    | CloudFront WAF: managed rules, rate limits, blocks sandbox and internal paths                            |
| `observability.tf`          | Encrypted log groups, SNS alarms (reconciliation, compensation, latency, 5xx, hosts, DB)                 |
| `outputs.tf`                | DNS targets, ECR URLs, migrate task parameters                                                           |
| `environments/`             | Per-environment variables and backend config (placeholder ARNs/domains)                                  |

## Checks (no AWS credentials needed)

```bash
make tf-validate   # terraform fmt -check, init -backend=false, validate (in Docker)
make tf-scan       # Trivy misconfiguration scan, fails on HIGH/CRITICAL
```

Both run in CI. Accepted scanner exceptions are annotated inline (`#trivy:ignore:…`) with the
reason.
