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
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection

def init_db() -> None:
    with connect() as connection:
        connection.execute("""CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY, user_id TEXT NOT NULL, source_json TEXT NOT NULL,
            files_json TEXT NOT NULL, created_at REAL NOT NULL, accessed_at REAL NOT NULL
        )""")
        connection.execute("CREATE INDEX IF NOT EXISTS projects_user_idx ON projects(user_id)")

def save_project(project: dict[str, Any]) -> None:
    with connect() as connection:
        connection.execute("""INSERT OR REPLACE INTO projects
            (id, user_id, source_json, files_json, created_at, accessed_at)
            VALUES (?, ?, ?, ?, ?, ?)""", (
                project["id"], project["user_id"], json.dumps(project["source"]),
                json.dumps(project["files"]), project["created_at"], project["accessed_at"],
            ))

def load_project(project_id: str) -> dict[str, Any] | None:
    with connect() as connection:
        row = connection.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
    if not row:
        return None
    return {"id": row["id"], "user_id": row["user_id"], "source": json.loads(row["source_json"]), "files": json.loads(row["files_json"]), "created_at": row["created_at"], "accessed_at": row["accessed_at"]}

def touch_project(project_id: str, accessed_at: float) -> None:
    with connect() as connection:
        connection.execute("UPDATE projects SET accessed_at = ? WHERE id = ?", (accessed_at, project_id))

def delete_project(project_id: str, user_id: str) -> bool:
    with connect() as connection:
        cursor = connection.execute("DELETE FROM projects WHERE id = ? AND user_id = ?", (project_id, user_id))
    return cursor.rowcount > 0

def list_projects(user_id: str) -> list[dict[str, Any]]:
    with connect() as connection:
        rows = connection.execute("SELECT id, source_json, created_at, accessed_at FROM projects WHERE user_id = ? ORDER BY accessed_at DESC", (user_id,)).fetchall()
    return [{"id": row["id"], "source": json.loads(row["source_json"]), "created_at": row["created_at"], "accessed_at": row["accessed_at"]} for row in rows]

def delete_expired(cutoff: float) -> None:
    with connect() as connection:
        connection.execute("DELETE FROM projects WHERE accessed_at < ?", (cutoff,))

init_db()
