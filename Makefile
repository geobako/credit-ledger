.DEFAULT_GOAL := help
.PHONY: help install up down reset logs db migrate dev build lint typecheck test test-int test-go lint-go format

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

install: ## Install JS dependencies
	pnpm install

up: ## Build and start the full stack
	docker compose up --build -d
	@echo "lending-api  → http://localhost:3000  (docs: /docs)"
	@echo "card-gateway → http://localhost:8081"

down: ## Stop the stack
	docker compose down

reset: ## Stop the stack and wipe the database volume
	docker compose down -v

logs: ## Tail service logs
	docker compose logs -f

db: ## Start only Postgres (for local dev / tests)
	docker compose up -d --wait postgres

migrate: db ## Apply database migrations to the local Postgres
	DATABASE_URL=postgres://acme:acme@localhost:5433/acme_credit pnpm --filter lending-api db:migrate
	DATABASE_URL=postgres://acme:acme@localhost:5433/acme_credit pnpm --filter lending-api db:seed

dev: migrate ## Run lending-api locally in watch mode against dockerised Postgres
	cp -n .env.example apps/lending-api/.env 2>/dev/null || true
	pnpm --filter lending-api start:dev

build: ## Build all packages
	pnpm build

lint: ## Lint all packages
	pnpm lint

typecheck: ## Type-check all packages
	pnpm typecheck

test: ## Run unit tests
	pnpm test

test-int: ## Run integration tests against a throwaway Postgres (Testcontainers, needs Docker)
	pnpm --filter lending-api test:int

# Go runs in a container: no local toolchain needed.
GO_RUN = docker run --rm -v $(CURDIR)/apps/card-gateway:/src -v acme-go-build-debian:/root/.cache/go-build -w /src golang:1.24

test-go: ## Run the card gateway's Go tests (race detector on)
	$(GO_RUN) go test -race -count=1 ./...

lint-go: ## gofmt + go vet for the card gateway
	$(GO_RUN) sh -c 'test -z "$$(gofmt -l .)" || (gofmt -l . && exit 1); go vet ./...'

format: ## Format the codebase
	pnpm format
