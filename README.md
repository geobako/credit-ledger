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
```

## Layout

| Path                | What                                                                                                  |
| ------------------- | ----------------------------------------------------------------------------------------------------- |
| `apps/lending-api`  | NestJS service — source of truth for collateral, cards and the ledger                                 |
| `apps/card-gateway` | Go service — card-network edge: validation, rate limits, circuit breaker, fail-closed timeouts        |
| `apps/web`          | React + Tailwind customer app and operations console (ledger, audit, reconciliation, concurrency lab) |
| `db/migrations`     | SQL migrations (schema source of truth)                                                               |
