"""Snapshot dashboard and account preferences; no repository code is executed."""
from __future__ import annotations

import json
import re
from pathlib import PurePosixPath
from typing import Any, Callable

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field, StrictBool, field_validator

from app.auth import User, user_preferences


class PreferencesPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    display_name: str = Field(default="", max_length=80, strict=True)
    reduced_motion: StrictBool = False
    compact_mode: StrictBool = False

    @field_validator("display_name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        if any(ord(char) < 32 or ord(char) == 127 for char in value):
            raise ValueError("display name cannot contain control characters")
        return value.strip()


NPM_NAME = re.compile(r"(?:@[a-zA-Z0-9_.-]+/)?[a-zA-Z0-9_.-]+")
REQUIREMENT = re.compile(
    r"(?P<name>[A-Za-z0-9][A-Za-z0-9._-]*(?:\[[A-Za-z0-9_,. -]+\])?)"
    r"\s*(?P<version>(?:(?:===|==|!=|~=|<=|>=|<|>)\s*[A-Za-z0-9.*+!_-]+"
    r"(?:\s*,\s*(?:===|==|!=|~=|<=|>=|<|>)\s*[A-Za-z0-9.*+!_-]+)*)?)"
)


def dependency_declarations(files: dict[str, str]) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
    """Only literal package.json entries and simple requirement declarations.

    Versions are declaration strings (including ranges), not resolved versions.
    Requirements options, includes, URLs and environment markers are not evaluated.
    """
    dependencies: list[dict[str, str]] = []
    warnings: list[dict[str, str]] = []
    for path, content in sorted(files.items()):
        name = PurePosixPath(path).name
        if name == "package.json":
            try:
                manifest = json.loads(content)
            except (ValueError, RecursionError):
                warnings.append({"path": path, "reason": "Dependency declarations unavailable: invalid package.json."})
                continue
            if not isinstance(manifest, dict):
                warnings.append({"path": path, "reason": "Dependency declarations unavailable: package.json must be an object."})
                continue
            for section in ("dependencies", "devDependencies", "peerDependencies", "optionalDependencies"):
                entries = manifest.get(section, {})
                if not isinstance(entries, dict):
                    warnings.append({"path": path, "reason": f"Skipped malformed {section} declarations."})
                    continue
                for dependency, version in sorted(entries.items()):
                    if not NPM_NAME.fullmatch(dependency) or not isinstance(version, str) or len(version) > 500 or any(ord(char) < 32 for char in version):
                        warnings.append({"path": path, "reason": "Skipped malformed dependency declaration."})
                        continue
                    entry = {"name": dependency, "version": version, "path": path}
                    if entry not in dependencies:
                        dependencies.append(entry)
        elif re.fullmatch(r"requirements(?:[-_.][A-Za-z0-9_.-]+)?\.txt", name):
            for line in content.splitlines():
                declaration = re.split(r"\s+#", line, maxsplit=1)[0].strip()
                if not declaration or declaration.startswith("#"):
                    continue
                match = REQUIREMENT.fullmatch(declaration)
                if not match:
                    warnings.append({"path": path, "reason": "Skipped unsupported requirements declaration (options, includes, URLs and markers are not evaluated)."})
                    continue
                entry = {"name": match.group("name"), "version": match.group("version").strip(), "path": path}
                if entry not in dependencies:
                    dependencies.append(entry)
    return dependencies, warnings


def snapshot_overview(project: dict[str, Any]) -> dict[str, Any]:
    analysis = project["analysis"]
    files = project["files"]
    analyzed = {item.path: item for item in analysis.files}
    packages: dict[str, dict[str, Any]] = {}
    languages: dict[str, dict[str, Any]] = {}
    total_lines = total_bytes = 0
    for path, content in sorted(files.items()):
        lines = len(content.splitlines())
        total_lines += lines
        total_bytes += len(content.encode("utf-8"))
        file = analyzed.get(path)
        directory = str(PurePosixPath(path).parent)
        package = packages.setdefault(directory, {"path": directory, "files": 0, "lines": 0, "symbols": 0})
        package["files"] += 1
        package["lines"] += lines
        package["symbols"] += len(file.symbols) if file else 0
        language = file.language if file and file.language else "unknown"
        group = languages.setdefault(language, {"name": language, "files": 0, "lines": 0})
        group["files"] += 1
        group["lines"] += lines
    dependencies, declaration_warnings = dependency_declarations(files)
    warnings = analysis.excluded + analysis.errors + [
        {"path": item.path, "reason": item.limitation} for item in analysis.files if item.limitation
    ] + declaration_warnings
    # Stable, deduplicated warnings; never return source contents as warning text.
    warnings = [dict(path=path, reason=reason) for path, reason in dict.fromkeys((item["path"], item["reason"]) for item in warnings)]
    return {
        "project_id": project["id"], "indexed_at": project["created_at"],
        "total_lines": total_lines, "total_bytes": total_bytes,
        "analyzed_files": sum(item.status == "analyzed" for item in analysis.files),
        "packages": [packages[key] for key in sorted(packages)],
        "languages": [languages[key] for key in sorted(languages)],
        "dependencies": dependencies, "warnings": warnings,
    }


def workspace_router(current_user: Callable, get_project: Callable) -> APIRouter:
    router = APIRouter(prefix="/api/v1")

    @router.get("/projects/{project_id}/overview")
    def overview(project_id: str, user: User = Depends(current_user)) -> dict[str, Any]:
        return snapshot_overview(get_project(project_id, user))

    @router.get("/users/me/preferences")
    def preferences(user: User = Depends(current_user)) -> dict[str, Any]:
        return user_preferences(user.id)

    @router.patch("/users/me/preferences")
    def update_preferences(payload: PreferencesPatch, user: User = Depends(current_user)) -> dict[str, Any]:
        return user_preferences(user.id, payload.model_dump(exclude_unset=True))

    return router
