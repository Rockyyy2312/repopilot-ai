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

The backend is available at `http://127.0.0.1:8000`; the frontend is available at `http://127.0.0.1:5173`. The frontend currently calls `/api/v1`, so use a local reverse proxy or the Vite proxy when running the two servers on separate ports.

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

The frontend uses `package-lock.json`; the backend pins all Python dependencies in `requirements.txt`.

## Docker plan

`backend/Dockerfile` provides a reproducible backend image. The frontend has its own multi-stage `frontend/Dockerfile`. During the foundation phase these images are intentionally separate so they can be deployed independently; a later phase may add a compose file or a reverse-proxy image without changing the application contracts.

## Repository hygiene

Only `.env.example` is intended for configuration examples. Real `.env` files, virtual environments, `node_modules`, Vite output, caches, logs, and credentials are ignored. No secrets should be committed.
