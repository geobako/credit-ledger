# Deployment

How Acme Credit runs on AWS. The infrastructure is in [`infra/terraform`](../infra/terraform);
see [ADR 0007](adr/0007-aws-ecs-fargate-and-rds.md) for why it looks the way it does.

> The Terraform is validated (`make tf-validate`) and security-scanned (`make tf-scan`) in CI.
> It has not been applied to a live account as part of this exercise.

## Environments

One AWS account per environment (staging, production), with the same code and different
`environments/<env>.tfvars`. Separate accounts give a hard blast-radius boundary for
credentials and quotas.

|                    | Staging                               | Production                            |
| ------------------ | ------------------------------------- | ------------------------------------- |
| AZs / NAT          | 2 / 1 shared                          | 3 / one per AZ                        |
| lending-api tasks  | 2–4                                   | 3–12                                  |
| card-gateway tasks | 2–4                                   | 3–12                                  |
| Database           | `db.t4g.medium`, Multi-AZ, 7-day PITR | `db.r7g.large`, Multi-AZ, 35-day PITR |

## First-time setup

1. Create the state bucket per account. It must be **versioned**, **SSE-KMS encrypted**, block
   public access, and allow access only to the deploy role. State contains generated secrets.
2. Issue the certificates (ACM):
   - the web certificate in **us-east-1** (CloudFront);
   - the API origin and network certificates in the primary region.
3. Put the card network's CA bundle in S3 (for the mTLS trust store).
4. Apply:

```bash
cd infra/terraform
terraform init -backend-config=environments/production.s3.tfbackend
terraform plan  -var-file=environments/production.tfvars -var image_tag=<git-sha> -out tf.plan
terraform apply tf.plan
```

5. Create DNS aliases from the outputs:
   - `web_domain` → `cloudfront_domain`;
   - `api_origin_domain` → `api_alb_dns_name`;
   - `network_domain` → `network_alb_dns_name`.

## Release pipeline

CI (`.github/workflows/ci.yml`) gates every change: lint, types, unit, integration, Go race
tests, Terraform validate + Trivy, and the full-stack E2E suite with a load smoke test. On
`main`, a deploy workflow (not included; it needs real AWS credentials via OIDC, never stored
keys) runs:

1. **Build and push** `lending-api` and `card-gateway` images tagged with the git SHA to ECR.
   Tags are immutable and images are scanned on push.
2. **Migrate.** Run the one-off migration task and wait for it to succeed (values come from
   the `migrate_task` output):

   ```bash
   aws ecs run-task --cluster <cluster> --task-definition <migrate family> --launch-type FARGATE \
     --network-configuration 'awsvpcConfiguration={subnets=[…],securityGroups=[…]}'
   aws ecs wait tasks-stopped …   # then assert exit code 0
   ```

   Migrations are forward-only, take a Postgres advisory lock (concurrent runs are safe), and
   must be **backward compatible** with the version still running (expand → migrate →
   contract across releases). The API never migrates at boot.

3. **Deploy services:** `terraform apply` with the new `image_tag`. ECS rolls out with
   `minimum_healthy_percent = 100` and the deployment circuit breaker, so failing health checks
   roll back automatically.
4. **Web:** `pnpm --filter web build`, sync to the web bucket (versioned), then invalidate
   `/index.html` (hashed assets need no invalidation).
5. **Smoke:** a reduced E2E against staging; production gets synthetic checks.

Staging first, then production, gated by approval.

### Rolling back

- **Services:** redeploy the previous SHA (images are kept, 50 per repository). The circuit
  breaker already does this for failed health checks.
- **Web:** restore the previous object versions, or redeploy the previous build.
- **Database:** migrations are not rolled back. Ship a forward fix. Because migrations are
  backward compatible, the previous service version keeps working against the new schema.

## Secrets

| Secret                               | Used by                   | Rotation                                                                                                                |
| ------------------------------------ | ------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `database-url`                       | lending-api, migrate      | Rotate the RDS password, update the secret, force a new deployment. Moving to RDS IAM auth removes the static password. |
| `webhook-secret`                     | lending-api               | Coordinate with the provider; support two active secrets during the switch (planned)                                    |
| `gateway-shared-secret`              | lending-api, card-gateway | Deploy both with old + new accepted, then remove old (planned dual-secret support)                                      |
| `network-api-key`                    | card-gateway              | Coordinate with the card network; the mTLS certificate is the primary credential                                        |
| `jwt-private-key` / `jwt-public-key` | lending-api               | Only for the simulated IdP. With a real IdP the API holds a JWKS URL, not a key.                                        |

Tasks read secrets at start, so rotation means updating the secret and forcing a new
deployment.

## Backups and disaster recovery

| Scenario                  | Protection                                                                                  | RPO     | RTO      |
| ------------------------- | ------------------------------------------------------------------------------------------- | ------- | -------- |
| Instance or AZ failure    | Multi-AZ synchronous standby, automatic failover                                            | 0       | ~1–2 min |
| Operator error / bad data | Point-in-time restore (35 days) to a new instance, then a forward fix from it               | ~5 min  | ~1 h     |
| Region loss               | Not covered today. Next step: cross-region read replica + snapshot copy, promoted manually. | minutes | hours    |

Restore drills should run quarterly against staging. After any restore, reconciliation and
audit verification must pass before traffic is allowed.

## Capacity notes

- Connections: tasks × `DATABASE_POOL_MAX` (20). At 12 API tasks that is 240, well within the
  instance limit; there is an alarm at 400.
- The authorization path holds a row lock for a few ms; a hot account is limited to hundreds of
  authorizations per second, far above real cards. The per-account queue keeps a hot account
  from affecting others (see ADR 0003).
- Load test: `make load` (k6) runs a steady gateway load and a contended hot card, and asserts
  latency thresholds and a clean reconciliation afterwards.
