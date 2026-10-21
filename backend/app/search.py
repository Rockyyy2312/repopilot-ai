"""Deterministic literal search with stable ranking and pre-pagination filters."""
from __future__ import annotations

from typing import Any

from fastapi import HTTPException
from pydantic import BaseModel, Field

from app.analysis.engine import safe_relative_path


class SearchRequest(BaseModel):
    query: str = Field(min_length=0, max_length=200)
    path: str | None = Field(default=None, max_length=500)
    language: str | None = Field(default=None, max_length=80)
    kind: str | None = Field(default=None, max_length=40)
    offset: int = Field(default=0, ge=0)
    limit: int = Field(default=50, ge=1, le=100)


def search_index(project: dict[str, Any], needle: str, requested_path: str | None, limit: int | None = None, language: str | None = None, kind: str | None = None, offset: int = 0) -> list[dict[str, Any]]:
    try:
        path_prefix = safe_relative_path(requested_path) if requested_path else None
    except ValueError as exc:
        raise HTTPException(400, "invalid path") from exc
    if not needle:
        return []
    needle = needle.casefold()
    files_by_path = {item.path: item for item in project["analysis"].files}
    candidates: dict[tuple[str, int], dict[str, Any]] = {}

    def add(path: str, line: int, match_kind: str, score: int, text: str) -> None:
        if path_prefix and not (path == path_prefix or path.startswith(path_prefix + "/")):
            return
        file_language = files_by_path[path].language
        if language and language.casefold() != (file_language or "unknown").casefold():
            return
        if kind and kind != match_kind:
            return
        key = (path, line)
        current = candidates.get(key)
        result = {"path": path, "line": line, "text": text[:1000], "kind": match_kind, "language": file_language}
        if current is None or score > current["_score"]:
            result["_score"] = score
            candidates[key] = result

    lines_by_path = {path: file.content.splitlines() for path, file in files_by_path.items()}
    for path in files_by_path:
        path_lower = path.casefold()
        if needle in path_lower:
            exact_path = needle == path_lower or needle == path.rsplit("/", 1)[-1].casefold()
            add(path, 1, "path", 80 if exact_path else 70, path)
        for line_number, line in enumerate(lines_by_path[path], 1):
            if needle in line.casefold():
                add(path, line_number, "content", 50, line)

    for symbol in project["analysis"].symbols:
        if symbol.name.casefold() == needle:
            text = lines_by_path[symbol.location.path][symbol.location.line - 1]
            add(symbol.location.path, symbol.location.line, "symbol", 100, text)

    for relation in project["analysis"].imports:
        if relation.module.casefold() == needle:
            text = lines_by_path[relation.location.path][relation.location.line - 1]
            add(relation.location.path, relation.location.line, "import", 90, text)

    ranked = sorted(candidates.values(), key=lambda item: (-item["_score"], item["path"], item["line"]))
    for result in ranked:
        result.pop("_score", None)
    return ranked[offset:offset + limit] if limit is not None else ranked[offset:]
