from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class SourceLocation:
    path: str
    line: int


@dataclass(frozen=True)
class Symbol:
    name: str
    kind: str
    location: SourceLocation


@dataclass(frozen=True)
class ImportRelation:
    module: str
    location: SourceLocation


@dataclass
class FileAnalysis:
    path: str
    language: str | None
    size: int
    content: str
    symbols: list[Symbol] = field(default_factory=list)
    imports: list[ImportRelation] = field(default_factory=list)
    status: str = "analyzed"
    limitation: str | None = None


@dataclass
class AnalysisResult:
    files: list[FileAnalysis]
    tree: dict[str, Any]
    languages: dict[str, int]
    symbols: list[Symbol]
    imports: list[ImportRelation]
    excluded: list[dict[str, str]]
    errors: list[dict[str, str]]

    def to_dict(self, include_content: bool = True) -> dict[str, Any]:
        def location(value: SourceLocation) -> dict[str, Any]:
            return {"path": value.path, "line": value.line}

        def symbol(value: Symbol) -> dict[str, Any]:
            return {"name": value.name, "kind": value.kind, "location": location(value.location)}

        def relation(value: ImportRelation) -> dict[str, Any]:
            return {"module": value.module, "location": location(value.location)}

        def file_value(value: FileAnalysis) -> dict[str, Any]:
            result: dict[str, Any] = {
                "path": value.path,
                "language": value.language,
                "size": value.size,
                "symbols": [symbol(item) for item in value.symbols],
                "imports": [relation(item) for item in value.imports],
                "status": value.status,
                "limitation": value.limitation,
            }
            if include_content:
                result["content"] = value.content
            return result

        return {
            "files": [file_value(item) for item in self.files],
            "tree": self.tree,
            "languages": self.languages,
            "symbols": [symbol(item) for item in self.symbols],
            "imports": [relation(item) for item in self.imports],
            "excluded": self.excluded,
            "errors": self.errors,
        }
