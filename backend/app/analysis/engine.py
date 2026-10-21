from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Iterable

from .languages import detect_language
from .models import AnalysisResult, FileAnalysis
from .parsers import parse_file


# Bump whenever analysis semantics change.  Persisted caches with an older
# version are ignored and rebuilt by the project loader.
ANALYSIS_VERSION = "1"

DEFAULT_EXCLUDED_DIRS = frozenset({".git", "node_modules", ".venv", "venv", "env", "__pycache__", "dist", "build", ".cache", ".pytest_cache", ".mypy_cache", ".tox", "coverage", "target", "vendor"})
SENSITIVE_NAMES = frozenset({".env", ".env.local", ".env.production", ".env.development", "id_rsa", "id_dsa", "id_ecdsa", "id_ed25519", "credentials", "credentials.json", "secrets.json"})
SENSITIVE_SUFFIXES = (".pem", ".key", ".p12", ".pfx", ".jks")
SECRET_CONTENT_PATTERNS = (
    re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    re.compile(r"(?:ghp|github_pat)_[A-Za-z0-9_]{20,}"),
    re.compile(r"AKIA[0-9A-Z]{16}"),
    re.compile(r"(?i)\b(?:api[_-]?key|secret|access[_-]?token|client[_-]?secret)\s*[:=]\s*[\"'][^\"']{12,}[\"']"),
)


@dataclass(frozen=True)
class AnalysisConfig:
    max_files: int = 5000
    max_file_bytes: int = 2 * 1024 * 1024
    excluded_dirs: frozenset[str] = DEFAULT_EXCLUDED_DIRS

    def __post_init__(self) -> None:
        if self.max_files < 1:
            raise ValueError("max_files must be positive")
        if self.max_file_bytes < 1:
            raise ValueError("max_file_bytes must be positive")


def safe_relative_path(path: str) -> str:
    normalized = path.replace("\\", "/")
    parsed = PurePosixPath(normalized)
    if not normalized or "\x00" in normalized or parsed.is_absolute() or any(part in {"", ".", ".."} for part in parsed.parts):
        raise ValueError("invalid relative path")
    return "/".join(parsed.parts)


def is_sensitive(path: str) -> bool:
    name = PurePosixPath(path).name.casefold()
    return name in SENSITIVE_NAMES or name.startswith(".env") or name in {".npmrc", ".pypirc", "config.json", "credentials.json"} or name.endswith(SENSITIVE_SUFFIXES)


def contains_sensitive_content(content: str) -> bool:
    return any(pattern.search(content) for pattern in SECRET_CONTENT_PATTERNS)


def _reason(path: str, config: AnalysisConfig) -> str | None:
    parts = PurePosixPath(path).parts
    if any(part.casefold() in config.excluded_dirs for part in parts[:-1]):
        return "excluded directory"
    if is_sensitive(path):
        return "sensitive file"
    return None


def discover_files(root: Path, config: AnalysisConfig | None = None) -> tuple[dict[str, str], list[dict[str, str]]]:
    config = config or AnalysisConfig()
    root = root.resolve()
    if not root.is_dir():
        raise ValueError("analysis root must be a directory")
    files: dict[str, str] = {}
    excluded: list[dict[str, str]] = []
    for current, dirs, names in os.walk(root, topdown=True, followlinks=False):
        current_path = Path(current)
        excluded_dirs = [d for d in dirs if d.casefold() in config.excluded_dirs]
        excluded.extend({"path": (current_path / d).relative_to(root).as_posix(), "reason": "excluded directory"} for d in excluded_dirs)
        dirs[:] = sorted(d for d in dirs if d.casefold() not in config.excluded_dirs and not (current_path / d).is_symlink())
        for name in sorted(names):
            candidate = current_path / name
            relative = candidate.relative_to(root).as_posix()
            try:
                clean = safe_relative_path(relative)
            except ValueError:
                excluded.append({"path": relative, "reason": "invalid relative path"})
                continue
            reason = _reason(clean, config)
            if reason:
                excluded.append({"path": clean, "reason": reason})
                continue
            if candidate.is_symlink():
                excluded.append({"path": clean, "reason": "symlink excluded"})
                continue
            try:
                size = candidate.stat().st_size
                if size > config.max_file_bytes:
                    excluded.append({"path": clean, "reason": "file exceeds configured size limit"})
                    continue
                data = candidate.read_bytes()
                files[clean] = data.decode("utf-8")
            except UnicodeDecodeError:
                excluded.append({"path": clean, "reason": "binary or non-UTF-8 file"})
            except OSError:
                excluded.append({"path": clean, "reason": "file could not be read"})
            if len(files) >= config.max_files:
                excluded.append({"path": "*", "reason": "file count limit reached"})
                return files, excluded
    return files, excluded


def analyze_files(files: dict[str, str], config: AnalysisConfig | None = None, excluded: Iterable[dict[str, str]] = ()) -> AnalysisResult:
    config = config or AnalysisConfig()
    selected = []
    errors: list[dict[str, str]] = []
    for raw_path in sorted(files):
        if len(selected) >= config.max_files:
            errors.append({"path": raw_path, "reason": "file count limit reached"})
            continue
        try:
            path = safe_relative_path(raw_path)
        except ValueError:
            errors.append({"path": raw_path, "reason": "invalid relative path"})
            continue
        reason = _reason(path, config)
        if reason:
            errors.append({"path": path, "reason": reason})
            continue
        content = files[raw_path]
        if contains_sensitive_content(content):
            errors.append({"path": path, "reason": "possible secret content"})
            continue
        size = len(content.encode("utf-8", errors="replace"))
        if size > config.max_file_bytes:
            errors.append({"path": path, "reason": "file exceeds configured size limit"})
            continue
        file = FileAnalysis(path, detect_language(path), size, content)
        parse_file(file)
        selected.append(file)
    languages: dict[str, int] = {}
    for file in selected:
        if file.language:
            languages[file.language] = languages.get(file.language, 0) + 1
    tree: dict[str, object] = {}
    for file in selected:
        cursor = tree
        parts = file.path.split("/")
        for part in parts[:-1]:
            child = cursor.setdefault(part, {})
            if isinstance(child, dict):
                cursor = child
        cursor[parts[-1]] = {"type": "file", "language": file.language}
    return AnalysisResult(selected, tree, dict(sorted(languages.items())), [symbol for file in selected for symbol in file.symbols], [relation for file in selected for relation in file.imports], list(excluded), errors)
