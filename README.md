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

## Test

```sh
python -m pytest
```
