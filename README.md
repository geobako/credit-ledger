# Acme Credit — Secured Card Lending

Service that owns Acme Credit's secured credit card lifecycle: collateral deposit → card activation → spending → repayment → collateral release or application.

> Work in progress. Architecture, design decisions and the full run guide land in `docs/`.

## Quick start

Requirements: Docker, Node 24 + pnpm 10.

```bash
make up        # builds and starts Postgres, runs migrations, starts lending-api
```

- API health: http://localhost:3000/health · readiness: http://localhost:3000/ready
- OpenAPI docs: http://localhost:3000/docs

## Local development

```bash
make install   # pnpm install
make dev       # Postgres in Docker, lending-api in watch mode
make test      # unit tests
make test-int  # integration + property tests against a throwaway Postgres (Testcontainers)
make lint typecheck
```

## Layout

| Path               | What                                                                  |
| ------------------ | --------------------------------------------------------------------- |
| `apps/lending-api` | NestJS service — source of truth for collateral, cards and the ledger |
| `db/migrations`    | SQL migrations (schema source of truth)                               |
