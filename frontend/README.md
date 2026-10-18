# RepoPilot AI frontend

React + TypeScript + Vite MVP for exploring repositories through the `/api/v1` backend.

## Setup

Requires Node `22.12.0` (see `.nvmrc`). From this directory:

```sh
npm ci
```

## Run

```sh
npm run dev
```

Vite serves the UI at `http://localhost:5173`. The API is expected at the same origin under `/api/v1` (configure a reverse proxy when developing against a separate backend).

## Test and build

```sh
npm test
npm run build
```

The test command is offline after `npm ci`; it covers API search-result normalization. The production build is emitted to `dist/`.

## Deploy with Docker

```sh
docker build -t repopilot-frontend .
docker run --rm -p 4173:4173 repopilot-frontend
```

The UI supports public GitHub import, ZIP/TAR archive upload, project inventory/tree browsing, line-numbered code search, read-only file previews, evidence/hypothesis issue investigation, import-graph summaries, and Markdown report downloads.
