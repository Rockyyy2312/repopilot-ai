from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from app.analysis.engine import safe_relative_path


@dataclass(frozen=True)
class StackFrame:
    path: str
    line: int
    symbol: str | None = None


PYTHON_FRAME = re.compile(r'File ["\'](?P<path>[^"\']+)["\'], line (?P<line>\d+)(?:, in (?P<symbol>[\w$<>()]+))?')
JS_FRAME = re.compile(r"at(?:\s+(?P<symbol>[\w$./<>-]+)\s+)?\(?((?P<path>[^():\s]+):(?P<line>\d+)(?::\d+)?)\)?")
ERROR_NAME = re.compile(r"(?:NameError|ReferenceError).*?['\"](?P<name>[A-Za-z_$][\w$]*)['\"]")
MODULE_ERROR = re.compile(r"(?:ModuleNotFoundError|ImportError|Cannot find module).*?['\"](?P<module>[^'\"]+)['\"]")
QUESTION_STOP_WORDS = frozenset({
    "the", "and", "for", "from", "this", "that", "with", "what", "where", "when", "which", "why", "how",
    "does", "could", "would", "should", "can", "are", "was", "were", "not", "into", "about", "please",
    "explain", "show", "find", "tell", "work", "works", "working", "code", "file", "files", "function",
    "functions", "defined", "definition", "implemented", "implementation", "repository", "project", "app",
    "return", "true", "false", "none", "null", "import", "class", "def", "const", "let", "var",
})


def question_source_matches(analysis: Any, question: str) -> list[dict[str, Any]]:
    """Bounded literal retrieval, not an inference about execution or causality."""
    terms = list(dict.fromkeys(term.casefold() for term in re.findall(r"[A-Za-z_$][\w$]*(?:[./-][\w$-]+)*", question)))
    terms = [term for term in terms if len(term) >= 3 and term not in QUESTION_STOP_WORDS][:12]
    if not terms:
        return []
    words = re.compile(r"(?<![\w$])(?:" + "|".join(re.escape(term) for term in terms) + r")(?![\w$])", re.IGNORECASE)
    candidates: dict[tuple[str, int], dict[str, Any]] = {}
    for file in analysis.files:
        lines = file.content.splitlines()
        symbol_lines = {item.location.line for item in file.symbols if item.name.casefold() in terms}
        import_lines = {item.location.line for item in file.imports if item.module.casefold() in terms}
        path_match = file.path.casefold() in terms or file.path.rsplit("/", 1)[-1].casefold() in terms
        # Limit lexical matches per file, preserving exact symbol/import locations.
        lexical_count = 0
        for line_number, line in enumerate(lines, 1):
            exact = line_number in symbol_lines or line_number in import_lines or (path_match and line_number == 1)
            lexical = lexical_count < 4 and words.search(line)
            if exact or lexical:
                candidates[(file.path, line_number)] = {"path": file.path, "line": line_number, "score": 2 if exact else 1}
                lexical_count += 1
    ranked = sorted(candidates.values(), key=lambda item: (-item["score"], item["path"], item["line"]))
    selected: list[dict[str, Any]] = []
    paths: set[str] = set()
    for match in ranked:
        if match["path"] not in paths and len(paths) >= 8:
            continue
        selected.append(match)
        paths.add(match["path"])
        if len(selected) >= 24:
            break
    return selected


def parse_stack_trace(stack_trace: str) -> list[StackFrame]:
    frames: list[StackFrame] = []
    for match in PYTHON_FRAME.finditer(stack_trace):
        try:
            path = safe_relative_path(match.group("path"))
        except ValueError:
            continue
        frames.append(StackFrame(path, int(match.group("line")), match.group("symbol")))
    for match in JS_FRAME.finditer(stack_trace):
        try:
            path = safe_relative_path(match.group("path"))
        except ValueError:
            continue
        frames.append(StackFrame(path, int(match.group("line")), match.group("symbol")))
    return list(dict.fromkeys(frames))


def investigate(project: dict[str, Any], question: str, error_message: str = "", stack_trace: str = "", file_context: str | None = None, symbol_context: str | None = None) -> dict[str, Any]:
    analysis = project["analysis"]
    files = {item.path: item for item in analysis.files}
    frames = parse_stack_trace(stack_trace)
    evidence: list[dict[str, Any]] = []
    relevant: dict[str, dict[str, Any]] = {}
    limitations: list[str] = []

    def add_file(path: str, reason: str, line: int | None = None, kind: str = "source") -> None:
        file = files.get(path)
        if not file:
            return
        entry = relevant.setdefault(path, {"path": path, "reason": reason, "symbols": []})
        if reason not in entry["reason"]:
            entry["reason"] += f"; {reason}"
        if line is not None and 1 <= line <= len(file.content.splitlines()):
            text = file.content.splitlines()[line - 1]
            evidence_key = (path, line, text)
            if not any((item["path"], item.get("line"), item.get("text")) == evidence_key for item in evidence):
                evidence.append({"path": path, "line": line, "text": text, "kind": kind})

    for frame in frames:
        add_file(frame.path, "referenced by stack trace", frame.line, "stack-trace")
        if frame.symbol:
            for item in analysis.symbols:
                if item.location.path == frame.path and item.name == frame.symbol:
                    relevant[frame.path]["symbols"].append({"name": item.name, "kind": item.kind, "path": item.location.path, "line": item.location.line})

    if file_context:
        try:
            clean_context = safe_relative_path(file_context)
        except ValueError:
            clean_context = None
            limitations.append("The supplied file context was not a safe relative path and was ignored.")
        if clean_context:
            add_file(clean_context, "supplied file context")

    if symbol_context:
        matches = [item for item in analysis.symbols if item.name.casefold() == symbol_context.casefold()]
        for item in matches:
            add_file(item.location.path, "supplied symbol context", item.location.line, "symbol")
            relevant[item.location.path]["symbols"].append({"name": item.name, "kind": item.kind, "path": item.location.path, "line": item.location.line})

    message = f"{error_message}\n{question}"
    module_match = MODULE_ERROR.search(message)
    name_match = ERROR_NAME.search(message)
    if module_match:
        module = module_match.group("module")
        for relation in analysis.imports:
            if relation.module.casefold() == module.casefold() or module.casefold() in relation.module.casefold():
                add_file(relation.location.path, "import matches the reported module", relation.location.line, "import")
    if name_match:
        name = name_match.group("name")
        for symbol in analysis.symbols:
            if symbol.name.casefold() == name.casefold():
                add_file(symbol.location.path, "symbol matches the reported name", symbol.location.line)

    lexical_terms = [term.strip() for term in (error_message, symbol_context or "") if term and term.strip()]
    for term in lexical_terms:
        term_lower = term.casefold()
        for path, file in files.items():
            for line_number, line in enumerate(file.content.splitlines(), 1):
                if term_lower in line.casefold():
                    add_file(path, "source line matches the reported context", line_number)

    if question and not any((error_message, stack_trace, file_context, symbol_context)):
        question_matches = question_source_matches(analysis, question)
        for match in question_matches:
            add_file(match["path"], "literal match to question terms; candidate source context", match["line"], "question-match")
            for item in files[match["path"]].symbols:
                if item.location.line == match["line"]:
                    symbol = {"name": item.name, "kind": item.kind, "path": item.location.path, "line": item.location.line}
                    if symbol not in relevant[match["path"]]["symbols"]:
                        relevant[match["path"]]["symbols"].append(symbol)
        if question_matches:
            limitations.append("Question-only retrieval uses bounded literal matches, not semantic understanding. Cited source lines are candidate context; they do not prove runtime behavior or a root cause.")

    for item in list(relevant.values()):
        for relation in analysis.imports:
            if relation.location.path == item["path"]:
                target = files.get(relation.module)
                if target:
                    add_file(target.path, f"imported by {item['path']}")

    hypotheses: list[dict[str, Any]] = []
    if module_match and evidence:
        hypotheses.append({"text": "The reported module/import relationship is a likely failure point.", "confidence": "high", "evidence": ["A reported module error matches an indexed import location."]})
    if name_match and not any(symbol.name.casefold() == name_match.group("name").casefold() for symbol in analysis.symbols):
        hypotheses.append({"text": "The referenced name may be undefined in the imported snapshot or may be misspelled.", "confidence": "medium", "evidence": ["The error names a symbol that was not found in the index."]})
    if frames and evidence:
        hypotheses.append({"text": "The failing execution path should be inspected at the stack-trace location and its callers.", "confidence": "medium", "evidence": ["The stack trace resolves to indexed source lines."]})
        limitations.append("A stack trace identifies where an exception surfaced; it does not prove the runtime root cause or that a related call caused it.")
    if not evidence:
        limitations.append("No stack-trace frame, symbol, import, or source line matched the indexed repository.")
        hypotheses.append({"text": "Available evidence is insufficient to identify a repository-grounded root cause.", "confidence": "low", "evidence": ["No relevant indexed evidence was found."]})

    if not frames and stack_trace:
        limitations.append("The stack trace format was not recognized; supported formats include Python and JavaScript/TypeScript frames.")
    next_steps = ["Inspect the cited source lines and surrounding callers."] if evidence else ["Provide a supported stack trace, file path, or symbol name from the repository."]
    if module_match:
        next_steps.append("Verify the reported module is installed, resolvable, and imported from the intended path.")
    if not analysis.files:
        limitations.append("The repository contains no analyzable UTF-8 source files.")

    return {
        "question": question,
        "summary": f"Collected {len(evidence)} evidence item(s) from {len(relevant)} relevant file(s)." if evidence else "No repository evidence was sufficient to explain this issue.",
        "confirmed_evidence": evidence,
        "relevant_files": sorted(relevant.values(), key=lambda item: item["path"]),
        "hypotheses": hypotheses,
        "recommended_next_steps": next_steps,
        "limitations": list(dict.fromkeys(limitations)),
    }
