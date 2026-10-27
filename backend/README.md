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

The AI Assistant uses `app/rag.py` to retrieve from the 1,000-record product Q&A corpus at `data/assistant_qa.jsonl` plus bounded chunks of the selected repository snapshot. It returns citations and limitations. Without `REPOPILOT_LLM_BASE_URL`, it uses a deterministic offline answer; an OpenAI-compatible chat-completions provider can be enabled with `REPOPILOT_LLM_BASE_URL`, `REPOPILOT_LLM_MODEL`, and `REPOPILOT_LLM_API_KEY`. Regenerate the reviewed corpus with `python scripts/build_assistant_dataset.py`.

Repository imports are isolated per user, persisted under the configured data directory, and never execute repository code or install dependencies. Imports are cleaned up after one hour without an API access and the server caches at most 100 projects and limits each user to 10 persisted projects. GitHub imports resolve the public repository default branch through the GitHub metadata endpoint, then download the matching `codeload.github.com` archive with a 15-second timeout, a 25 MiB compressed limit, and do not follow redirects. Archive imports accept ZIP, TAR, TAR.GZ, and TGZ files with a 50 MiB extracted-size limit.

## Test

```sh
python -m pytest
```
