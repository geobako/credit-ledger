# Threat model

STRIDE analysis of the deployed system ([architecture](ARCHITECTURE.md#12-deployment)). For
each threat: the mitigation that exists in this repository, and what remains.

## Assets

| Asset                                                                  | Why it matters                                                           |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Customer collateral and balances                                       | Direct financial loss; regulatory exposure                               |
| The ledger and audit log                                               | The legal record of every movement; must be complete and unaltered       |
| Credit decisions (authorizations)                                      | Wrong approvals are unsecured losses                                     |
| Signing secrets (JWT key, webhook secret, gateway secret, network key) | Whoever holds them can impersonate a party                               |
| Customer identity and card data                                        | Privacy; PCI scope (PANs are never stored, only a network token + last4) |

## Trust boundaries

```
Internet ──► CloudFront+WAF ──► API ALB ──► lending-api ──► Postgres
Card network ──(mTLS)──► Network ALB ──► card-gateway ──(HMAC)──► lending-api
Payment provider ──(signed webhook)──► CloudFront ──► lending-api
Operator ──(AWS IAM, CI/CD)──► ECS / RDS / Secrets Manager
```

## Threats and mitigations

### Spoofing

| Threat                                           | Mitigation                                                                                                                                            | Residual risk                                                                        |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Forged customer or ops identity                  | ES256 JWTs; issuer and audience pinned; algorithm pinned (no `none`/HS confusion); short TTL; deny-by-default guard                                   | IdP is simulated; production should use a real OIDC IdP with MFA (mandatory for ops) |
| Fake card-network traffic                        | Mutual TLS at the network ALB (trust store); source CIDR allow-list; network API key; malformed messages rejected at the gateway                      | Key compromise at the network side; rotate via Secrets Manager                       |
| Fake gateway calling the API's internal endpoint | HMAC over timestamp + method + path + body; 5-minute window; WAF blocks `/api/v1/network/*` from the internet; security groups allow only the gateway | Secret compromise; rotate (dual-secret window planned)                               |
| Forged payment confirmations (free collateral)   | Stripe-style HMAC with timestamp freshness; amount must match the expected payment exactly; unknown references ignored                                | Provider-side compromise                                                             |
| Calling the API origin directly, bypassing WAF   | ALB security group admits only CloudFront ranges; listener requires the secret `X-Origin-Verify` header; only `/v1/*` forwarded                       | Header secret leak; rotate                                                           |

### Tampering

| Threat                                      | Mitigation                                                                                                                                                                   | Residual risk                                                                                                                            |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Editing balances or history in the database | Ledger append-only (triggers), cached balances writable only by the posting trigger, entries must balance at commit, CHECKs on limits; hourly reconciliation alarms on drift | A superuser can disable triggers. Least-privilege app role (no DDL) and IAM-gated DB access are the next step.                           |
| Editing or deleting audit records           | Immutable rows (trigger), SHA-256 hash chain verified on demand and in reconciliation                                                                                        | Full-chain rewrite by a superuser; anchor the head hash in WORM storage (S3 Object Lock)                                                 |
| Tampering in transit                        | TLS everywhere at the edge; Postgres `verify-full`; HMAC on internal calls                                                                                                   | Gateway→API hop is HTTP inside the VPC (integrity covered by HMAC, confidentiality by private subnets; Service Connect TLS is an option) |
| Mass assignment / parameter tampering       | DTO whitelisting with `forbidNonWhitelisted`; server computes every amount (limit, closure payout) itself; amounts as validated strings                                      | —                                                                                                                                        |
| Replaying a captured signed request         | Timestamps with tight windows; idempotency keys and natural keys make replays no-ops                                                                                         | Replay within the window is harmless by idempotency                                                                                      |

### Repudiation

| Threat                                            | Mitigation                                                                                                                             |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| "I never made that payment / closed that account" | Every state change is audited with actor, request id and payload in the same transaction as the change, and sealed into the hash chain |
| Operator actions without a trail                  | Ops actions go through the same audited API (charge-off is audited with the ops actor); AWS actions in CloudTrail                      |

### Information disclosure

| Threat                                       | Mitigation                                                                                                                                     | Residual risk                                                                           |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Enumerating other customers' accounts (IDOR) | Every lookup scoped by principal; foreign resources return 404 (no existence oracle); UUIDs                                                    | —                                                                                       |
| Secrets in logs, images or code              | Secrets only from Secrets Manager at task start; log redaction of auth headers and signatures; card token never logged                         | Terraform state holds generated secrets: encrypted, versioned, restricted bucket        |
| Card data exposure                           | No PAN stored; network token + last4 only; customers never see the token                                                                       | —                                                                                       |
| Internal endpoints exposed                   | `/metrics`, `/docs`, `/debug/vars` and health probes are not routed by either ALB; sandbox disabled by config in production and blocked at WAF | —                                                                                       |
| XSS stealing tokens                          | Strict CSP (no inline script), React escaping, token in sessionStorage (same-origin only)                                                      | XSS would still read sessionStorage; an httpOnly cookie session (BFF) would remove that |

### Denial of service

| Threat                                     | Mitigation                                                                                |
| ------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Floods at the edge                         | WAF rate-based rules (global and stricter on auth); CloudFront absorbs volumetric traffic |
| Card-testing bursts on one card            | Per-card token bucket at the gateway (code `65`)                                          |
| One hot account starving the database pool | Per-account in-process queue, with load shedding beyond 100 queued (ADR 0003)             |
| API slowness causing network timeouts      | Gateway fails closed in 1.5 s and the circuit breaker sheds load instantly                |
| Sign-in abuse / account farming            | 10 requests per minute per IP on sign-in and registration (API), plus a WAF rule          |
| Large bodies / slow clients                | Body size limits; ALB timeouts; `idle_in_transaction_session_timeout` in Postgres         |

### Elevation of privilege

| Threat                                | Mitigation                                                                                                                                                  | Residual risk                                            |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Customer reaching ops endpoints       | `@Roles('ops')` on the whole ops controller; charge-off checked in the service as well                                                                      | —                                                        |
| Customer writing off their own debt   | Closure with uncovered debt is refused for customers (`422`); only ops can charge off                                                                       | Four-eyes approval for charge-offs (planned)             |
| Container breakout / lateral movement | Non-root, read-only root filesystems, distroless gateway image, no ECS Exec, empty task roles, security groups per hop, data subnets without internet route | —                                                        |
| Supply chain                          | Lockfiles (pnpm, Go has no dependencies, Terraform provider hashes); ECR scan on push; immutable tags; Trivy IaC scan in CI                                 | Image signing (cosign) and SBOM generation not yet in CI |

## Security testing in this repository

- Unit and integration tests:
  - forged and expired tokens;
  - cross-customer access → 404;
  - role checks;
  - webhook signature, freshness and replay;
  - gateway signature;
  - audit-log tampering detection.
- The E2E `security.test.ts` re-checks the boundaries against the running stack, including
  gateway mTLS stand-ins (network key), malformed messages and card-testing throttling.
- `make tf-scan` (Trivy) has no HIGH/CRITICAL findings. Accepted exceptions are annotated in
  the code with reasons: public load balancers by design, and SSE-S3 for ALB logs and public
  static assets.
