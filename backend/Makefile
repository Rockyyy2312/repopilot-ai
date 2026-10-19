SHELL := /bin/sh
PYTHON ?= python3

.PHONY: test backend-test frontend-test build typecheck docker-build

test: backend-test frontend-test

backend-test:
	cd backend && $(PYTHON) -m pytest -q

frontend-test:
	npm --prefix frontend test -- --run

build:
	npm --prefix frontend run build

typecheck:
	npm --prefix frontend exec tsc -p tsconfig.app.json --noEmit

docker-build:
	docker build -t repopilot-ai:local .
