"""Generate the versioned RepoPilot product Q&A corpus.

The records are curated intent/answer pairs expanded into realistic question
wordings. They describe only behavior present in the current website and API;
the output is deterministic so it can be reviewed, regenerated, and tested.
"""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).parents[1]
OUTPUT = ROOT / "data" / "assistant_qa.jsonl"

INTENTS = [
    ("overview", "RepoPilot", "RepoPilot is an evidence-first repository exploration workspace. It imports a bounded source snapshot, indexes files and symbols, and presents searchable code, architecture relationships, and issue evidence without executing repository code.", ["What is RepoPilot?", "What does the RepoPilot website do?", "Can you explain the RepoPilot product?", "What problem does RepoPilot solve?", "How should I think about this code intelligence workspace?"]),
    ("imports", "public GitHub repository", "Open Repositories, provide a public `https://github.com/owner/repository` URL, and start the import. RepoPilot resolves the repository default branch, downloads a bounded archive, extracts safe UTF-8 source files, and analyzes the snapshot.", ["How do I import a GitHub repository?", "How can I add a public GitHub project?", "What is the GitHub import flow?", "Can RepoPilot read a public repository?", "Where do I enter a GitHub URL?"]),
    ("imports", "archive upload", "Open Repositories and upload a `.zip`, `.tar`, `.tar.gz`, or `.tgz` archive. The archive is bounded, checked for unsafe paths and sensitive files, then analyzed as an immutable snapshot.", ["How do I upload a repository archive?", "Which archive formats can I import?", "Can I upload a ZIP file?", "How does local repository upload work?", "Where can I add a tarball?"]),
    ("imports", "import limits", "Imports are bounded for safety. The application limits archive size, extracted bytes, member count, file count, and individual file size; generated, dependency, binary, and sensitive paths may be excluded.", ["What limits apply to repository imports?", "Why was a large repository rejected?", "How are archive sizes controlled?", "What happens when an archive has too many files?", "Why are some imported files excluded?"]),
    ("imports", "import jobs", "Repository imports can run as asynchronous jobs. The UI receives a job ID, shows queued/running progress, and opens the project after the job succeeds. Failed and cancelled states remain explicit.", ["How do import jobs work?", "Why does an import show queued?", "Where can I see import progress?", "Can I cancel an import job?", "What happens if an import fails?"]),
    ("search", "Code Search", "Use Code Search to find exact source text, indexed symbols, and import references. Results are grouped by file, ranked by match kind, and can be filtered by path, language, and kind.", ["How do I search the codebase?", "Where can I find a function?", "Can I search imports and symbols?", "How does source search work?", "How do I narrow search results?"]),
    ("search", "search filters", "Code Search supports path, language, and result-kind filters. Use a path such as `src/`, choose a detected language, or select symbol, content, or import matches.", ["Can I filter search by directory?", "How do I search only TypeScript files?", "What search filters are available?", "Can I show only symbols?", "How do I narrow results to imports?"]),
    ("analysis", "static analysis", "RepoPilot performs deterministic static analysis. It discovers files, detects supported languages, extracts selected symbols and imports, builds a directory tree, and records limitations without running the source.", ["What does the analyzer inspect?", "Is RepoPilot static analysis?", "How is a repository analyzed?", "Does the analyzer execute code?", "What information is extracted from source files?"]),
    ("analysis", "supported languages", "The current analyzer has structural parsers for Python, JavaScript, and TypeScript variants. Other UTF-8 text files can remain searchable while being marked unsupported for structural parsing.", ["Which programming languages are supported?", "Does RepoPilot understand Python?", "Can it analyze TypeScript?", "What happens to unsupported file types?", "Are JavaScript files indexed?"]),
    ("analysis", "symbols and imports", "The index records source-located symbols and import references where the parser supports them. Each result keeps a file path and line location so the UI can open source context.", ["How are symbols indexed?", "Can I see where imports occur?", "Does the graph use source locations?", "Why does a symbol have a line number?", "What are indexed imports?"]),
    ("analysis", "analysis limitations", "Warnings identify excluded paths, parser errors, unsupported files, possible secrets, and other limits. A warning means the snapshot has an explicit boundary; it is not a runtime or security verdict.", ["What do analysis warnings mean?", "Why is a file marked limited?", "Are warnings security findings?", "How should I interpret parser errors?", "Does an analyzed snapshot cover everything?"]),
    ("architecture", "Architecture Canvas", "Open Architecture to inspect the bounded direct import graph. File nodes represent repository files, unresolved modules are labeled external, and edges include import evidence and source line information.", ["How do I view repository architecture?", "What does the Architecture Canvas show?", "How is the import graph built?", "What are external graph nodes?", "Can I inspect file relationships?"]),
    ("architecture", "graph bounds", "Large graphs can be bounded by scope, depth, and node/edge limit. The response reports truncation totals so a smaller view is not mistaken for a complete graph.", ["Can I limit the architecture graph?", "Why is the graph truncated?", "What do graph depth and scope mean?", "How do I inspect one directory in the graph?", "Does the graph show all files by default?"]),
    ("investigation", "Issue Assistant", "Issue Assistant accepts a question, error message, or stack trace and returns confirmed source evidence separately from hypotheses, next steps, and limitations.", ["How does Issue Assistant work?", "Where can I investigate an error?", "Can I paste a stack trace?", "What does the issue assistant return?", "How do I find evidence for a failure?"]),
    ("investigation", "evidence", "Confirmed evidence is a matching source line, symbol, import, or supported stack-trace location. Evidence is cited with path and line when available; it does not prove causality.", ["What counts as confirmed evidence?", "Does an evidence match prove the bug?", "How are issue findings cited?", "Why does the assistant show source lines?", "Can evidence identify a root cause?"]),
    ("investigation", "hypotheses", "Hypotheses are explicitly labeled and accompanied by evidence descriptions and confidence. They are review suggestions derived from the index, not claims that the application was executed.", ["What are investigation hypotheses?", "How should I read confidence labels?", "Are hypotheses guaranteed diagnoses?", "Why are findings separate from hypotheses?", "Does confidence mean the bug is confirmed?"]),
    ("security", "safe snapshot", "RepoPilot treats imported repositories as untrusted data. It does not install dependencies or execute repository code, and it excludes sensitive names and possible secret content from the analyzable snapshot.", ["Is it safe to import a repository?", "Does RepoPilot run my code?", "Are dependencies installed during analysis?", "How are secrets handled?", "What is the safe snapshot boundary?"]),
    ("security", "ownership", "Authenticated users can access only their own imported projects and jobs. Project, search, graph, investigation, file, and delete operations apply ownership checks.", ["Can another user see my repository?", "How is project access controlled?", "Are jobs private to their owner?", "What protects imported source data?", "Can users access each other's projects?"]),
    ("reports", "Markdown report", "Use Export report or Export summary to download a Markdown document containing repository metadata, evidence, hypotheses, next steps, symbols, and analysis limitations.", ["Can I export an investigation?", "How do I download a Markdown report?", "What is included in the report?", "Can I share a repository analysis summary?", "Where is the export action?"]),
    ("workspace", "repository workspace", "The workspace provides Overview, Code Search, Issue Assistant, Architecture, Repositories, and Settings scenes. The selected repository snapshot remains the context for exploration.", ["What screens are in the workspace?", "How do I switch repositories?", "Where are settings?", "How does the selected repository affect answers?", "What can I do after importing a project?"]),
]

VARIATIONS = [
    "{base}",
    "As a new user, {base_lower}",
    "In the RepoPilot workspace, {base_lower}",
    "For a code review, {base_lower}",
    "I am exploring a repository; {base_lower}",
    "Please explain this: {base_lower}",
    "What should I know if {base_lower}",
    "Can you give a practical answer to this: {base_lower}",
    "While using the website, {base_lower}",
    "For the current product, {base_lower}",
]


def main() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    rows: list[dict[str, object]] = []
    record_id = 1
    for category, topic, answer, questions in INTENTS:
        for index in range(50):
            base = questions[index % len(questions)]
            variation = VARIATIONS[(index // len(questions)) % len(VARIATIONS)]
            question = variation.format(base=base, base_lower=base[0].lower() + base[1:])
            rows.append({
                "id": f"rp-qa-{record_id:04d}",
                "question": question,
                "answer": answer,
                "category": category,
                "tags": [topic, category],
                "source": "RepoPilot product documentation",
            })
            record_id += 1
    if len(rows) != 1000:
        raise RuntimeError(f"expected 1000 records, generated {len(rows)}")
    OUTPUT.write_text("".join(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n" for row in rows), encoding="utf-8")
    print(f"wrote {len(rows)} records to {OUTPUT}")


if __name__ == "__main__":
    main()
