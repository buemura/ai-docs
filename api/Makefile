.DEFAULT_GOAL := help

HOST ?= 127.0.0.1
PORT ?= 8000

.PHONY: help install env dev run test lint format format-check check clean

help: ## Show available commands
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies (including dev group)
	uv sync

env: ## Create .env from .env.example if missing
	@test -f .env || (cp .env.example .env && echo "Created .env — set your API key")

dev: ## Run the API with auto-reload
	uv run fastapi dev app/main.py --host $(HOST) --port $(PORT)

run: ## Run the API without auto-reload
	uv run fastapi run app/main.py --host $(HOST) --port $(PORT)

test: ## Run tests (pass extra args with ARGS="-k name")
	uv run pytest $(ARGS)

lint: ## Lint with ruff
	uv run ruff check .

format: ## Format code and apply autofixable lint fixes
	uv run ruff check --fix .
	uv run ruff format .

format-check: ## Check formatting without modifying files
	uv run ruff format --check .

check: lint format-check test ## Run lint, format check, and tests (CI)

clean: ## Remove caches
	find . -type d -name __pycache__ -not -path './.venv/*' -exec rm -rf {} +
	rm -rf .pytest_cache .ruff_cache
