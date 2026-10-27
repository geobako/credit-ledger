# Acme Credit — Secured Card Lending

Service that owns Acme Credit's secured credit card lifecycle: collateral deposit → card activation → spending → repayment → collateral release or application.

> Work in progress. Architecture, design decisions and the full run guide land in `docs/`.

## Quick start

Requirements: Docker, Node 24 + pnpm 10.

```bash
make up        # builds and starts Postgres, migrations, lending-api, card-gateway and the web app
```

- **Web app: http://localhost:8080** — sign in as Alice or Bob (customers) or Olivia (operations)
- API health: http://localhost:3000/health · readiness: http://localhost:3000/ready
- OpenAPI docs: http://localhost:3000/docs

## Local development

```bash
make install   # pnpm install
make dev       # Postgres in Docker, lending-api in watch mode
make web       # web app with hot reload on http://localhost:5173 (proxies /api to :3000)
make test      # unit tests
make test-int  # integration + property tests against a throwaway Postgres (Testcontainers)
make test-go   # Go gateway tests with the race detector (runs in Docker, no Go install needed)
make lint typecheck

make up && make e2e   # end-to-end suite: real gateway, signed webhooks, concurrency, security
make load             # k6: steady gateway traffic + one contended "hot" card, then reconciliation
```

CI (`.github/workflows/ci.yml`) runs all of the above on every push: lint, types, unit,
integration (Testcontainers), Go with the race detector, then the full stack in Docker with the
E2E suite and a short load smoke test.

## Layout

| Path                | What                                                                                                  |
| ------------------- | ----------------------------------------------------------------------------------------------------- |
| `apps/lending-api`  | NestJS service — source of truth for collateral, cards and the ledger                                 |
| `apps/card-gateway` | Go service — card-network edge: validation, rate limits, circuit breaker, fail-closed timeouts        |
| `apps/web`          | React + Tailwind customer app and operations console (ledger, audit, reconciliation, concurrency lab) |
| `e2e`               | End-to-end suite (Node test runner) against the running stack, plus the load-test seeder              |
| `load`              | k6 load test for the authorization hot path                                                           |
| `db/migrations`     | SQL migrations (schema source of truth)                                                               |
