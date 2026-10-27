from __future__ import annotations

import ast
import re

from .models import FileAnalysis, ImportRelation, SourceLocation, Symbol

JS_IMPORT_SOURCE = re.compile(r"\bfrom\s*['\"]([^'\"]+)['\"]")
JS_SIDE_EFFECT_IMPORT = re.compile(r"^\s*import\s*['\"]([^'\"]+)['\"]")
JS_EXPORT_SOURCE = re.compile(r"^\s*export\s+(?:\*|\{[\s\S]*?\})\s+from\s*['\"]([^'\"]+)['\"]")
JS_EXPORT_IMPORT = re.compile(r"^\s*(?:export\s+)?(?:const|let|var|function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)")
JS_REQUIRE = re.compile(r"\brequire\(\s*['\"]([^'\"]+)['\"]\s*\)")
JS_DYNAMIC_IMPORT = re.compile(r"\bimport\(\s*['\"]([^'\"]+)['\"]\s*\)")
PY_FROM = re.compile(r"^\s*from\s+([\w.]+)\s+import\s+")
PY_IMPORT = re.compile(r"^\s*import\s+([\w.]+)")


def parse_python(file: FileAnalysis) -> None:
    try:
        tree = ast.parse(file.content, filename=file.path)
    except (SyntaxError, ValueError, UnicodeError) as exc:
        file.status = "invalid"
        file.limitation = f"Python parser rejected this file: {type(exc).__name__}"
        return
    nodes = sorted(ast.walk(tree), key=lambda node: (getattr(node, "lineno", 0), getattr(node, "col_offset", 0)))
    for node in nodes:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            file.symbols.append(Symbol(node.name, "class" if isinstance(node, ast.ClassDef) else "function", SourceLocation(file.path, node.lineno)))
        elif isinstance(node, ast.Import):
            for alias in node.names:
                file.imports.append(ImportRelation(alias.name, SourceLocation(file.path, node.lineno)))
        elif isinstance(node, ast.ImportFrom):
            if node.module:
                file.imports.append(ImportRelation(node.module, SourceLocation(file.path, node.lineno)))


def parse_javascript(file: FileAnalysis) -> None:
    lines = file.content.splitlines()
    seen_imports: set[tuple[str, int]] = set()

    def add_import(module: str, line_no: int) -> None:
        key = (module, line_no)
        if key not in seen_imports:
            seen_imports.add(key)
            file.imports.append(ImportRelation(module, SourceLocation(file.path, line_no)))

    line_no = 1
    while line_no <= len(lines):
        line = lines[line_no - 1]
        stripped = line.strip()
        statement = line
        if stripped.startswith("import ") or stripped == "import":
            end = line_no
            while end < len(lines) and ";" not in statement and not JS_IMPORT_SOURCE.search(statement) and not JS_SIDE_EFFECT_IMPORT.search(statement):
                end += 1
                statement += "\n" + lines[end - 1]
            match = JS_SIDE_EFFECT_IMPORT.search(statement) or JS_IMPORT_SOURCE.search(statement)
            if match:
                add_import(match.group(1), line_no)
        export_match = JS_EXPORT_SOURCE.search(statement) if stripped.startswith("export ") else None
        if export_match:
            add_import(export_match.group(1), line_no)
        for match in JS_DYNAMIC_IMPORT.finditer(line):
            add_import(match.group(1), line_no)
        for match in JS_REQUIRE.finditer(line):
            add_import(match.group(1), line_no)
        match = JS_EXPORT_IMPORT.search(line)
        if match:
            keyword = next((word for word in ("class", "function", "interface", "type", "enum", "const", "let", "var") if re.search(rf"\b{word}\b", line)), "function")
            file.symbols.append(Symbol(match.group(1), "class" if keyword == "class" else keyword, SourceLocation(file.path, line_no)))
        for match in re.finditer(r"\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)", line):
            if not any(symbol.name == match.group(1) and symbol.location.line == line_no for symbol in file.symbols):
                file.symbols.append(Symbol(match.group(1), "function", SourceLocation(file.path, line_no)))
        line_no += 1


def parse_file(file: FileAnalysis) -> None:
    if file.language == "python":
        parse_python(file)
    elif file.language in {"javascript", "typescript"}:
        parse_javascript(file)
    else:
        file.status = "unsupported"
        file.limitation = "Language is not supported by the Phase 1 parser. Content remains searchable."
