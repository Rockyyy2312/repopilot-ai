from __future__ import annotations

import json
import os
import sqlite3
import time
from pathlib import Path
from typing import Any

DB_PATH = os.environ.get("REPOPILOT_PROJECT_DB", os.path.join(os.environ.get("REPOPILOT_DATA_DIR", "./data"), "repopilot-projects.sqlite3"))
Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)

def connect() -> sqlite3.Connection:
    # Every operation gets its own short-lived connection.  WAL lets readers
    # continue while an import is writing, while busy_timeout avoids transient
    # "database is locked" errors when two requests finish together.
    if DB_PATH != ":memory:":
        Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH, timeout=5.0)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA busy_timeout = 5000")
    try:
        connection.execute("PRAGMA journal_mode = WAL")
        connection.execute("PRAGMA synchronous = NORMAL")
    except sqlite3.OperationalError:
        # WAL is unavailable for some SQLite-backed test databases (notably
        # in-memory databases).  The connection remains usable in rollback
        # journal mode with the busy timeout still applied.
        pass
    return connection

def init_db() -> None:
    with connect() as connection:
        connection.execute("""CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY, user_id TEXT NOT NULL, source_json TEXT NOT NULL,
            files_json TEXT NOT NULL, created_at REAL NOT NULL, accessed_at REAL NOT NULL,
            analysis_version TEXT, analysis_input_hash TEXT, analysis_json TEXT,
            summary_json TEXT
        )""")
        columns = {row["name"] for row in connection.execute("PRAGMA table_info(projects)").fetchall()}
        # Existing installations predate durable analysis metadata.  Nullable
        # columns preserve those rows and are filled the next time a project is
        # loaded or saved.
        for name, definition in (
            ("analysis_version", "TEXT"),
            ("analysis_input_hash", "TEXT"),
            ("analysis_json", "TEXT"),
            ("summary_json", "TEXT"),
        ):
            if name not in columns:
                connection.execute(f"ALTER TABLE projects ADD COLUMN {name} {definition}")
        connection.execute("CREATE INDEX IF NOT EXISTS projects_user_idx ON projects(user_id)")

def save_project(project: dict[str, Any]) -> None:
    summary = project.get("summary") or {}
    if not summary:
        source = project.get("source") or {}
        analysis = project.get("analysis")
        warnings = []
        if analysis is not None:
            warnings = list(getattr(analysis, "excluded", ())) + list(getattr(analysis, "errors", ()))
            warnings.extend(item for item in getattr(analysis, "files", ()) if getattr(item, "limitation", None))
        summary = {
            "repository_name": source.get("repo") if source.get("type") == "github" else source.get("filename", "uploaded-repository"),
            "file_count": len(project.get("files", {})),
            "symbol_count": len(getattr(analysis, "symbols", ())) if analysis is not None else None,
            "import_count": len(getattr(analysis, "imports", ())) if analysis is not None else None,
            "languages": getattr(analysis, "languages", None) if analysis is not None else None,
            "warning_count": len(warnings),
        }
    with connect() as connection:
        connection.execute("""INSERT OR REPLACE INTO projects
            (id, user_id, source_json, files_json, created_at, accessed_at,
             analysis_version, analysis_input_hash, analysis_json, summary_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""", (
                project["id"], project["user_id"], json.dumps(project["source"]),
                json.dumps(project["files"]), project["created_at"], project["accessed_at"],
                project.get("analysis_version"), project.get("analysis_input_hash"),
                json.dumps(project["analysis_cache_json"]) if project.get("analysis_cache_json") is not None else None,
                json.dumps(summary, separators=(",", ":")),
            ))

def load_project(project_id: str) -> dict[str, Any] | None:
    with connect() as connection:
        row = connection.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
    if not row:
        return None
    cached = None
    if row["analysis_json"]:
        try:
            cached = json.loads(row["analysis_json"])
        except (TypeError, json.JSONDecodeError):
            cached = None
    summary = None
    if row["summary_json"]:
        try:
            summary = json.loads(row["summary_json"])
        except (TypeError, json.JSONDecodeError):
            summary = None
    return {
        "id": row["id"], "user_id": row["user_id"],
        "source": json.loads(row["source_json"]), "files": json.loads(row["files_json"]),
        "created_at": row["created_at"], "accessed_at": row["accessed_at"],
        "analysis_version": row["analysis_version"],
        "analysis_input_hash": row["analysis_input_hash"],
        "analysis_cache_json": cached,
        "summary": summary,
    }

def touch_project(project_id: str, accessed_at: float) -> None:
    with connect() as connection:
        connection.execute("UPDATE projects SET accessed_at = ? WHERE id = ?", (accessed_at, project_id))

def delete_project(project_id: str, user_id: str) -> bool:
    with connect() as connection:
        cursor = connection.execute("DELETE FROM projects WHERE id = ? AND user_id = ?", (project_id, user_id))
    return cursor.rowcount > 0

def count_projects(user_id: str) -> int:
    with connect() as connection:
        row = connection.execute("SELECT COUNT(*) AS count FROM projects WHERE user_id = ?", (user_id,)).fetchone()
    return int(row["count"])


def list_projects(user_id: str) -> list[dict[str, Any]]:
    with connect() as connection:
        rows = connection.execute("SELECT id, source_json, files_json, summary_json, created_at, accessed_at FROM projects WHERE user_id = ? ORDER BY accessed_at DESC", (user_id,)).fetchall()
    projects = []
    for row in rows:
        try:
            summary = json.loads(row["summary_json"]) if row["summary_json"] else {}
        except (TypeError, json.JSONDecodeError):
            summary = {}
        source = json.loads(row["source_json"])
        files = None
        if not summary:
            try:
                files = json.loads(row["files_json"])
            except (TypeError, json.JSONDecodeError):
                files = {}
            repository_name = source.get("repo") if source.get("type") == "github" else source.get("filename", "uploaded-repository")
            summary = {"repository_name": repository_name, "file_count": len(files), "symbol_count": 0, "import_count": 0, "languages": {}, "warning_count": 0}
        projects.append({
            "id": row["id"],
            "repository_name": summary.get("repository_name") or "uploaded-repository",
            "source": source,
            "file_count": summary.get("file_count") or 0,
            "symbol_count": summary.get("symbol_count") or 0,
            "import_count": summary.get("import_count") or 0,
            "languages": summary.get("languages") or {},
            "warning_count": summary.get("warning_count") or 0,
            "created_at": row["created_at"],
            "accessed_at": row["accessed_at"],
        })
    return projects

def delete_expired(cutoff: float) -> None:
    with connect() as connection:
        connection.execute("DELETE FROM projects WHERE accessed_at < ?", (cutoff,))

init_db()
