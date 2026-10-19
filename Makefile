SHELL := /bin/sh
.PHONY: test backend-test frontend-test build typecheck docker-build

test: backend-test frontend-test

backend-test:
	cd backend && if [ -x .venv/bin/python ]; then .venv/bin/python -m pytest -q; else python3 -m pytest -q; fi

frontend-test:
	npm --prefix frontend test -- --run

build:
	npm --prefix frontend run build

typecheck:
	cd frontend && ./node_modules/.bin/tsc -p tsconfig.app.json --noEmit

docker-build:
	docker build -t repopilot-ai:local .
