# RepoPilot AI backend

## Setup and run

Requires Python 3.11. From this directory:

```sh
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

The API is available under `/api/v1`. In production set `REPOPILOT_ENV=production`, a stable `REPOPILOT_SESSION_SECRET`, and `REPOPILOT_SECURE_COOKIES=true`. It persists imported project snapshots and metadata under `REPOPILOT_DATA_DIR` while maintaining an in-memory analysis cache. It never executes repository code. `POST /projects/import/github` validates a GitHub URL; archive imports accept zip, tar, and tar.gz uploads with bounded file and archive sizes.

Repository analysis is implemented in `app/analysis/`: discovery excludes generated, dependency, virtual-environment, cache, and sensitive paths; Python uses the standard-library AST parser; JavaScript/TypeScript use deterministic parser fallbacks; unsupported and invalid files remain represented with explicit limitations. `GET /api/v1/projects/{project_id}/analysis` returns the directory tree, detected languages, source-located symbols/imports, excluded paths, and parse errors. Limits can be adjusted with `REPOPILOT_MAX_FILES` and `REPOPILOT_MAX_FILE_BYTES`.

Repository imports are isolated in memory and never execute repository code or install dependencies. Imports are cleaned up after one hour without an API access and the server retains at most 20 projects, evicting the least-recently-accessed project when the cap is exceeded. GitHub imports use a fixed `codeload.github.com` archive URL, a 15-second timeout, a 25 MiB compressed limit, and do not follow redirects. Archive imports accept ZIP, TAR, TAR.GZ, and TGZ files with a 50 MiB extracted-size limit.

## Test

```sh
python -m pytest
```
