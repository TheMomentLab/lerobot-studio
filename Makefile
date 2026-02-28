SHELL := /bin/bash

# lerobot is tracked as a git submodule
LEROBOT_PATH ?= lerobot

.PHONY: install install-full dev dev-tools lint typecheck test test-cov check build-frontend clean help

## install: Init submodule + install both (editable, no-deps for lerobot)
install:
	git submodule update --init "$(LEROBOT_PATH)"
	pip install --no-deps -e "$(LEROBOT_PATH)"
	pip install -e .

## install-full: Same as install but resolves all lerobot dependencies (may change torch)
install-full:
	git submodule update --init "$(LEROBOT_PATH)"
	pip install -e "$(LEROBOT_PATH)"
	pip install -e .

## dev: Init submodule + install with dev dependencies (no-deps for lerobot)
dev:
	git submodule update --init "$(LEROBOT_PATH)"
	pip install --no-deps -e "$(LEROBOT_PATH)"
	pip install -e ".[dev]"

## dev-tools: Install backend dev toolchain only (ruff/mypy/pytest-cov)
dev-tools:
	pip install -e ".[dev]"

## build-frontend: Build the React frontend
build-frontend:
	cd frontend && npm ci && npm run build

## test: Run unit tests (no hardware required)
test:
	PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python -m pytest -q -m "not smoke_hw" tests

## test-cov: Run unit tests with coverage (no hardware required)
test-cov:
	PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python -m pytest -q -p pytest_cov -m "not smoke_hw" --cov=lestudio --cov-report=term-missing --cov-report=xml tests

## lint: Lint backend code
lint:
	ruff check src/lestudio

## typecheck: Type-check backend code
typecheck:
	mypy src/lestudio --ignore-missing-imports

## check: Run backend quality gate (lint + typecheck + tests + coverage)
check: lint typecheck test test-cov

## test-hw: Run hardware smoke tests (requires physical devices)
test-hw:
	LESTUDIO_RUN_HW_SMOKE=1 PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python -m pytest -q -m "smoke_hw" tests/smoke_hw

## clean: Remove build artifacts and caches
clean:
	rm -rf build dist *.egg-info src/*.egg-info
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true

help:
	@grep -E '^##' Makefile | sed 's/## /  /'
