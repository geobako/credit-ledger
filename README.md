# Acme Credit: Secured Card Lending

The service behind Acme Credit's secured credit card. A customer deposits collateral, gets a card
whose limit is derived from it, spends, repays, and at closure gets the collateral back, or
sees it applied to anything still owed.

**Highlights**

- A double-entry ledger in integer cents, with invariants enforced by the database, not just
  the code.
- Purchases can never exceed the limit, even under 100 simultaneous requests.
- Every money-moving entry point is idempotent.
- A Go card gateway that fails closed and compensates late approvals.
- A hash-chained audit log, hourly reconciliation, a polished web app, and AWS Terraform.

| Read next                                                                     |                                                                                        |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)                                  | How it works and why: money model, concurrency, idempotency, failure modes, trade-offs |
| [docs/adr/](docs/adr/README.md)                                               | The seven key decisions, with alternatives considered                                  |
| [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md)                                  | STRIDE analysis, mitigations and residual risks                                        |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) · [docs/RUNBOOK.md](docs/RUNBOOK.md) | AWS deployment, releases, DR; what to do when an alarm fires                           |
| [infra/terraform/](infra/terraform/README.md)                                 | The AWS infrastructure                                                                 |
| [PROMPTS.md](PROMPTS.md)                                                      | The AI-assisted development log                                                        |

## Quick start

Requirements: **Docker** and **Node 24 + pnpm 10**. Go, Terraform and k6 run in containers.

```bash
pnpm install
make up        # Postgres, migrations, lending-api, card-gateway and the web app
```

|                             |                                                                                                                            |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Web app**                 | http://localhost:8080. Sign in as **Alice** or **Bob** (customers) or **Olivia** (operations), or register a new customer. |
| API + OpenAPI docs          | http://localhost:3000/docs                                                                                                 |
| Card gateway (network side) | http://localhost:8081 (header `X-Network-Key: local-dev-network-key-change-me`)                                            |

`make down` stops everything; `make reset` also wipes the database.

### A five-minute tour

1. **As a customer** (register one so you start fresh): open an account. The card is inactive.
2. **Add collateral** → $500 → _Bank confirms_. This sends the payment provider's signed webhook
   through the real verification path. The card activates with a $500 limit.
3. Use the **card network simulator**: approve a purchase, try one over the limit (declined
   _Insufficient credit_), freeze the card and watch purchases decline, then capture or reverse
   pending ones.
4. **Make a payment**: available credit comes back once it settles.
5. **Close the account**: the dialog previews the settlement. Debt is paid from collateral and
   the rest is returned.
6. **As Olivia (ops)**:
   - **Ledger:** every entry is balanced.
   - **Reconciliation:** 8/8 checks pass.
   - **Audit trail → Verify chain:** the hash chain is intact.
   - **Concurrency lab:** fire 40 simultaneous purchases at one card. Exactly
     ⌊available ÷ amount⌋ are approved, never one more.

Or drive the card network directly through the Go gateway:

```bash
curl -s localhost:8081/v1/authorizations \
  -H 'X-Network-Key: local-dev-network-key-change-me' -H 'Content-Type: application/json' \
  -d '{"network_transaction_id":"demo-0001","card_token":"tok_<32 hex>","amount":1250,"currency":"USD","merchant":{"name":"Blue Bottle","mcc":"5814"}}'
```

Card tokens are network-side identifiers that customers never see. List them with:

```bash
docker compose exec postgres psql -U acme acme_credit -c 'SELECT network_token, last4, status FROM cards;'
```

## How the brief is covered

| Requirement                                              | Where                                                                                                                                                      |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Collateral deposit, confirmed before it counts           | Payment instructions → signed provider webhook → ledger entry → limit ([§2](docs/ARCHITECTURE.md#2-domain-model))                                          |
| Card activation with a limit derived from collateral     | Limit = confirmed collateral × advance rate (bps, rounding down); top-ups raise it                                                                         |
| Spending never exceeds the limit                         | Account row lock + DB `CHECK (outstanding + held <= limit)` + per-account queue ([§4](docs/ARCHITECTURE.md#4-concurrency))                                 |
| Repayments restore credit                                | Settled repayments credit the receivable; overpayments are kept as a refund owed, never lost                                                               |
| Release collateral in good standing, or apply it to debt | Closure settlement plan; customers cannot close with uncovered debt; ops-only charge-off                                                                   |
| Concurrency                                              | Pessimistic locking, deadlock-free lock order, automatic retries; proven by integration, E2E and load tests                                                |
| Idempotency                                              | Keys stored in the same transaction as the effect ([§5](docs/ARCHITECTURE.md#5-idempotency))                                                               |
| Consistency                                              | One transaction per command; transactional outbox; append-only ledger; reconciliation                                                                      |
| Auditability                                             | Audit row per change (actor, request id) in the same transaction; SHA-256 hash chain; ledger as financial record                                           |
| Security                                                 | JWT + deny-by-default + ownership (404 not 403), HMAC service auth, signed webhooks, mTLS for the network, WAF, KMS ([threat model](docs/THREAT_MODEL.md)) |
| Money handling                                           | Integer minor units end to end (Postgres `bigint` → TS `bigint` → JSON strings → Go `int64`); no floats, enforced by lint                                  |
| Cloud deployment (IaC)                                   | [infra/terraform](infra/terraform/README.md): ECS Fargate, RDS Multi-AZ, CloudFront + WAF, Secrets Manager, KMS, alarms                                    |
| Architecture and trade-offs                              | [ARCHITECTURE.md](docs/ARCHITECTURE.md) + [ADRs](docs/adr/README.md)                                                                                       |

## Development

```bash
make help        # every target
make dev         # Postgres in Docker + lending-api in watch mode (:3000)
make web         # web app with hot reload (:5173, proxies /api to :3000)
```

## Tests

| Command                             | What runs                                                                                                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `make test`                         | Unit and property-based tests (lending-api Jest + fast-check, web Vitest)                                                                                                |
| `make test-int`                     | 88 integration tests against a throwaway Postgres (Testcontainers): every flow, races, DB-level tamper protection                                                        |
| `make test-go` · `make lint-go`     | Gateway tests under the race detector; gofmt + vet                                                                                                                       |
| `make up && make e2e`               | 40 end-to-end tests against the running stack: lifecycle via the real gateway, debt at closure, idempotency, 100-way concurrency, security boundaries, then books checks |
| `make load`                         | k6: steady gateway traffic plus a contended hot card, with latency thresholds and reconciliation afterwards                                                              |
| `make tf-validate` · `make tf-scan` | Terraform fmt/validate and a Trivy security scan                                                                                                                         |
| `make lint typecheck`               | ESLint (including a no-floats-for-money rule) and strict TypeScript                                                                                                      |

CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs all of it on every push,
including the full Docker stack with the E2E suite and a load smoke test.

## Repository layout

| Path                | What                                                                                                                                                |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/lending-api`  | NestJS service: the single owner of money (accounts, collateral, cards, authorizations, repayments, closure, ledger, audit, outbox, reconciliation) |
| `apps/card-gateway` | Go service, standard library only: card-network edge with validation, per-card rate limits, fail-closed deadlines, compensation, circuit breaker    |
| `apps/web`          | React + Tailwind customer app and operations console                                                                                                |
| `db/migrations`     | SQL migrations (Drizzle-generated + hand-written triggers and constraints)                                                                          |
| `e2e`               | End-to-end suite (Node test runner) and the load-test seeder                                                                                        |
| `load`              | k6 load test                                                                                                                                        |
| `infra/terraform`   | AWS infrastructure                                                                                                                                  |
| `docs`              | Architecture, ADRs, threat model, deployment, runbook                                                                                               |

## What's simulated

The identity provider (passwordless demo sign-in issuing real ES256 JWTs), the payment provider
(the sandbox sends signed webhooks through the production code path) and the card network (the
web simulator and the Go gateway's network API). The sandbox is refused at startup in
production and blocked at the WAF.
