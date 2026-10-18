from __future__ import annotations

from pathlib import PurePosixPath

LANGUAGE_BY_EXTENSION = {
    ".py": "python",
    ".js": "javascript",
    ".jsx": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".ts": "typescript",
    ".tsx": "typescript",
}


def detect_language(path: str) -> str | None:
    return LANGUAGE_BY_EXTENSION.get(PurePosixPath(path).suffix.casefold())
