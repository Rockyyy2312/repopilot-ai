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

    def add_file(path: str, reason: str, line: int | None = None) -> None:
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
                evidence.append({"path": path, "line": line, "text": text, "kind": "stack-trace"})

    for frame in frames:
        add_file(frame.path, "referenced by stack trace", frame.line)
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
            add_file(item.location.path, "supplied symbol context", item.location.line)
            relevant[item.location.path]["symbols"].append({"name": item.name, "kind": item.kind, "path": item.location.path, "line": item.location.line})

    message = f"{error_message}\n{question}"
    module_match = MODULE_ERROR.search(message)
    name_match = ERROR_NAME.search(message)
    if module_match:
        module = module_match.group("module")
        for relation in analysis.imports:
            if relation.module.casefold() == module.casefold() or module.casefold() in relation.module.casefold():
                add_file(relation.location.path, "import matches the reported module", relation.location.line)
                evidence.append({"path": relation.location.path, "line": relation.location.line, "text": files[relation.location.path].content.splitlines()[relation.location.line - 1], "kind": "import"})
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
