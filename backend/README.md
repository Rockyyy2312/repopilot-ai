# RepoPilot AI backend

## Setup and run

Requires Python 3.11. From this directory:

```sh
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

The API is available under `/api/v1`. It keeps imported projects in memory and never executes repository code. `POST /projects/import/github` validates a GitHub URL; archive imports accept zip, tar, and tar.gz uploads with bounded file and archive sizes.

Repository analysis is implemented in `app/analysis/`: discovery excludes generated, dependency, virtual-environment, cache, and sensitive paths; Python uses the standard-library AST parser; JavaScript/TypeScript use deterministic parser fallbacks; unsupported and invalid files remain represented with explicit limitations. `GET /api/v1/projects/{project_id}/analysis` returns the directory tree, detected languages, source-located symbols/imports, excluded paths, and parse errors. Limits can be adjusted with `REPOPILOT_MAX_FILES` and `REPOPILOT_MAX_FILE_BYTES`.

## Test

```sh
python -m pytest
```
