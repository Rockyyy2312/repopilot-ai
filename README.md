# RepoPilot AI

RepoPilot AI is deployed as one container: a FastAPI application serves `/api/v1` and the production Vite bundle from the same origin. This avoids a production proxy dependency and keeps frontend API calls relative and reproducible.

## Supported runtimes

- Node.js `22.12.0` (pinned in `frontend/.nvmrc`)
- Python `3.11` (pinned in `backend/.python-version`)

## Local development

From the repository root, copy the placeholder configuration if needed:

```sh
cp .env.example .env
```

Terminal 1 — backend:

```sh
cd backend
python -m venv .venv
# Windows PowerShell: .venv\\Scripts\\Activate.ps1
# macOS/Linux: source .venv/bin/activate
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Terminal 2 — frontend:

```sh
cd frontend
npm ci
npm run dev
```

The backend is available at `http://127.0.0.1:8000`; the frontend is available at `http://127.0.0.1:5173`. Vite proxies `/api` to the backend during development. Set `VITE_API_PROXY_TARGET` if the backend uses another address. For production, use the root Docker image so frontend and API share one origin.

## Health checks

Backend:

```sh
curl http://127.0.0.1:8000/api/v1/health
```

Expected response: `{"status":"ok"}`.

Frontend smoke health check:

```sh
cd frontend
npm run build
```

This type-checks and produces the static Vite bundle. Opening the dev URL and seeing the RepoPilot shell confirms the frontend server is serving the application.

## Tests

From the repository root, run the complete offline-after-install test command:

```sh
make test
```

Individual suites:

Run backend tests:

```sh
cd backend
python -m pytest
```

Run frontend tests:

```sh
cd frontend
npm test
```

On Windows, where `make` may not be installed, run the equivalent checks directly:

```powershell
cd backend
python -m pytest -q
python -m compileall -q app

cd ..\frontend
npm test -- --run
npm run build
npm run test:styles
```

The frontend uses `package-lock.json`; the backend pins all Python dependencies in `requirements.txt`. The backend stores auth and project metadata under `REPOPILOT_DATA_DIR`; mount that directory in deployments and provide a stable `REPOPILOT_SESSION_SECRET`.

## Production Docker build

The root `Dockerfile` is the production deployment path. Mount `/app/data` as a persistent volume and provide a stable `REPOPILOT_SESSION_SECRET`; production cookies require HTTPS. It uses Node `22.12.0` to install the locked frontend dependencies and build the Vite bundle, then Python `3.11` to run FastAPI as the non-root `repopilot` user. The final image contains no `.env` files, Git metadata, Node toolchain, or imported repositories.

Build and run:

```sh
docker build --pull -t repopilot-ai:local .
docker run --rm --name repopilot-ai -p 8000:8000 --env-file .env repopilot-ai:local
```

The single-origin application is available at `http://127.0.0.1:8000/`; its API is at `http://127.0.0.1:8000/api/v1`. Verify both paths and the container health check:

```sh
curl http://127.0.0.1:8000/api/v1/health
curl http://127.0.0.1:8000/
docker inspect --format='{{json .State.Health}}' repopilot-ai
```

The image build runs the frontend tests/build and backend tests in isolated build stages. After the image/dependency layers are present, test targets can run without network access:

```sh
docker build --target backend-test -t repopilot-ai-backend-tests .
docker run --rm --network none repopilot-ai-backend-tests python -m pytest -q

docker build --target frontend-test -t repopilot-ai-frontend-tests .
docker run --rm --network none repopilot-ai-frontend-tests npm test -- --run
```

The frontend communicates with the backend through the same-origin `/api/v1` path in the production image, so no CORS or separate frontend service is required.

## Product scope note

The current release is a deterministic static repository analysis product by default. It does not use embeddings or claim runtime understanding. The Issue Assistant and Architecture Canvas are evidence-oriented static analysis features; the optional AI provider requires explicit provider, privacy, and credential configuration.

The Issue Assistant now also includes an evidence-first AI Assistant. It retrieves from `backend/data/assistant_qa.jsonl` and the selected repository snapshot, returns source citations, and works offline with a deterministic fallback. Set `REPOPILOT_LLM_BASE_URL`, `REPOPILOT_LLM_MODEL`, and `REPOPILOT_LLM_API_KEY` to enable an OpenAI-compatible provider. Regenerate the 1,000-record product corpus with `cd backend && python scripts/build_assistant_dataset.py`.

## SaaS scale-up architecture

For the recommended multi-tenant architecture, migration phases, data model, worker design, security controls, and testing strategy, see [SAAS_ARCHITECTURE.md](SAAS_ARCHITECTURE.md).

## Repository hygiene

Only `.env.example` is intended for configuration examples. Real `.env` files, virtual environments, `node_modules`, Vite output, caches, logs, and credentials are ignored. No secrets should be committed.
