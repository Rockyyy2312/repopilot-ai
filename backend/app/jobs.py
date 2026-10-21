"""Durable job records and ownership-aware state transitions.

The records live in SQLite so a process restart does not erase the audit trail.  This
module intentionally does not provide a distributed worker: the import endpoint uses
one bounded in-process worker, which is safe for a single-process deployment only.
"""

from __future__ import annotations

import json
import os
import sqlite3
import time
import uuid
from pathlib import Path
from typing import Any

DB_PATH = os.environ.get("REPOPILOT_JOBS_DB", os.path.join(os.environ.get("REPOPILOT_DATA_DIR", "./data"), "repopilot-jobs.sqlite3"))
Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
STATUSES = {"queued", "running", "succeeded", "failed", "cancelled"}


def _connect() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH, timeout=30)
    connection.row_factory = sqlite3.Row
    return connection


def init_db() -> None:
    with _connect() as connection:
        connection.execute("""CREATE TABLE IF NOT EXISTS jobs (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            kind TEXT NOT NULL,
            status TEXT NOT NULL,
            progress REAL NOT NULL DEFAULT 0,
            message TEXT NOT NULL DEFAULT '',
            payload_json TEXT NOT NULL DEFAULT '{}',
            result_json TEXT,
            error TEXT,
            created_at REAL NOT NULL,
            started_at REAL,
            finished_at REAL,
            updated_at REAL NOT NULL,
            CHECK(status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled'))
        )""")
        connection.execute("CREATE INDEX IF NOT EXISTS jobs_user_idx ON jobs(user_id, created_at)")


def _as_dict(row: sqlite3.Row, include_payload: bool = False) -> dict[str, Any]:
    result: dict[str, Any] = {
        "id": row["id"],
        "status": row["status"],
        "progress": row["progress"],
        "message": row["message"],
        "created_at": row["created_at"],
        "started_at": row["started_at"],
        "finished_at": row["finished_at"],
        "updated_at": row["updated_at"],
    }
    if row["result_json"] is not None:
        result["result"] = json.loads(row["result_json"])
    if row["error"]:
        result["error"] = row["error"]
    if include_payload:
        result["kind"] = row["kind"]
        result["payload"] = json.loads(row["payload_json"])
    return result


def create_job(user_id: str, kind: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    now = time.time()
    job_id = uuid.uuid4().hex
    with _connect() as connection:
        connection.execute(
            """INSERT INTO jobs (id, user_id, kind, status, progress, message, payload_json, created_at, updated_at)
               VALUES (?, ?, ?, 'queued', 0, ?, ?, ?, ?)""",
            (job_id, user_id, kind, "Queued", json.dumps(payload or {}), now, now),
        )
        row = connection.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
    return _as_dict(row)


def get_job(job_id: str, user_id: str) -> dict[str, Any] | None:
    # Filtering by owner in the query avoids leaking whether another user's id exists.
    with _connect() as connection:
        row = connection.execute("SELECT * FROM jobs WHERE id = ? AND user_id = ?", (job_id, user_id)).fetchone()
    return _as_dict(row) if row else None


def get_job_for_worker(job_id: str) -> dict[str, Any] | None:
    with _connect() as connection:
        row = connection.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
    if not row:
        return None
    result = _as_dict(row, include_payload=True)
    result["user_id"] = row["user_id"]
    return result


def update_job(job_id: str, *, status: str | None = None, progress: float | None = None,
              message: str | None = None, result: dict[str, Any] | None = None,
              error: str | None = None, only_status: str | None = None) -> dict[str, Any] | None:
    if status is not None and status not in STATUSES:
        raise ValueError("invalid job status")
    now = time.time()
    fields: list[str] = ["updated_at = ?"]
    values: list[Any] = [now]
    if status is not None:
        fields.append("status = ?")
        values.append(status)
        if status == "running":
            fields.append("started_at = COALESCE(started_at, ?)")
            values.append(now)
        if status in {"succeeded", "failed", "cancelled"}:
            fields.append("finished_at = COALESCE(finished_at, ?)")
            values.append(now)
    if progress is not None:
        fields.append("progress = ?")
        values.append(max(0.0, min(1.0, float(progress))))
    if message is not None:
        fields.append("message = ?")
        values.append(message[:1000])
    if result is not None:
        fields.append("result_json = ?")
        values.append(json.dumps(result))
    if error is not None:
        fields.append("error = ?")
        values.append(error[:2000])
    query = "UPDATE jobs SET " + ", ".join(fields) + " WHERE id = ?"
    values.append(job_id)
    if only_status is not None:
        query += " AND status = ?"
        values.append(only_status)
    with _connect() as connection:
        cursor = connection.execute(query, values)
        row = connection.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
    return _as_dict(row) if cursor.rowcount and row else None


def cancel_job(job_id: str, user_id: str) -> dict[str, Any] | None:
    """Cancel queued/running work atomically; a running task observes this state before publishing."""
    now = time.time()
    with _connect() as connection:
        cursor = connection.execute(
            """UPDATE jobs SET status = 'cancelled', message = 'Cancelled by user',
               finished_at = ?, updated_at = ?
               WHERE id = ? AND user_id = ? AND status IN ('queued', 'running')""",
            (now, now, job_id, user_id),
        )
        row = connection.execute("SELECT * FROM jobs WHERE id = ? AND user_id = ?", (job_id, user_id)).fetchone()
    return _as_dict(row) if row and cursor.rowcount else (_as_dict(row) if row else None)


def reset_jobs() -> None:
    """Test helper; production callers should retain job history."""
    with _connect() as connection:
        connection.execute("DELETE FROM jobs")


init_db()
