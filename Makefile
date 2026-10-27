.DEFAULT_GOAL := help
.PHONY: help install up down reset logs db dev build lint typecheck test format

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

install: ## Install JS dependencies
	pnpm install

up: ## Build and start the full stack
	docker compose up --build -d
	@echo "lending-api → http://localhost:3000  (docs: /docs)"

down: ## Stop the stack
	docker compose down

reset: ## Stop the stack and wipe the database volume
	docker compose down -v

logs: ## Tail service logs
	docker compose logs -f

db: ## Start only Postgres (for local dev / tests)
	docker compose up -d --wait postgres

dev: db ## Run lending-api locally in watch mode against dockerised Postgres
	pnpm --filter lending-api start:dev

build: ## Build all packages
	pnpm build

lint: ## Lint all packages
	pnpm lint

typecheck: ## Type-check all packages
	pnpm typecheck

test: ## Run all unit tests
	pnpm test

format: ## Format the codebase
	pnpm format
