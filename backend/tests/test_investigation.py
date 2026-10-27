from app.analysis import AnalysisConfig, analyze_files, discover_files
from app.investigation import investigate, parse_stack_trace


def make_project(files):
    return {"analysis": analyze_files(files)}


def test_parses_python_and_javascript_stack_frames():
    frames = parse_stack_trace('File "src/app.py", line 12, in run\n at render (src/ui.ts:8:4)')

    assert [(frame.path, frame.line, frame.symbol) for frame in frames] == [
        ("src/app.py", 12, "run"),
        ("src/ui.ts", 8, "render"),
    ]


def test_investigation_reports_import_evidence_and_ranked_hypothesis():
    project = make_project({"buggy_app.py": "from missing_service import Client\n\ndef start_app():\n    return Client().start()\n"})

    report = investigate(
        project,
        "The app fails during startup",
        "ModuleNotFoundError: No module named 'missing_service'",
        'Traceback (most recent call last):\n  File "buggy_app.py", line 4, in start_app\n',
    )

    assert {(item["path"], item["line"]) for item in report["confirmed_evidence"]} >= {("buggy_app.py", 1), ("buggy_app.py", 4)}
    assert report["hypotheses"][0]["confidence"] == "high"
    assert report["relevant_files"][0]["symbols"][0]["name"] == "start_app"
    assert any("does not prove" in limitation for limitation in report["limitations"])


def test_investigation_deduplicates_module_error_evidence():
    project = make_project({"app.py": "from missing_service import Client\n"})

    report = investigate(
        project,
        "Why does startup fail?",
        "ModuleNotFoundError: No module named 'missing_service'",
    )

    matching = [item for item in report["confirmed_evidence"] if item["path"] == "app.py" and item["line"] == 1]
    assert matching == [{"path": "app.py", "line": 1, "text": "from missing_service import Client", "kind": "import"}]


def test_investigation_is_inconclusive_without_matching_evidence():
    project = make_project({"main.py": "def healthy():\n    return True\n"})

    report = investigate(project, "Why does deployment fail?", "RuntimeError: remote failure", "")

    assert report["confirmed_evidence"] == []
    assert report["hypotheses"][0]["confidence"] == "low"
    assert "sufficient" in report["summary"]
    assert report["recommended_next_steps"]


def test_investigation_ignores_unsafe_stack_paths_and_keeps_line_accuracy():
    project = make_project({"app.py": "def run():\n    return 1\n"})

    report = investigate(project, "Failure", "", 'File "../app.py", line 1, in run\n')

    assert report["confirmed_evidence"] == []
    assert any("format" in limitation for limitation in report["limitations"])


def test_investigation_respects_analysis_file_limit():
    analysis = analyze_files({"a.py": "def a():\n    pass\n", "b.py": "def b():\n    pass\n"}, AnalysisConfig(max_files=1))
    report = investigate({"analysis": analysis}, "Why is b unavailable?", "", "", "b.py", "b")

    assert report["confirmed_evidence"] == []
    assert report["hypotheses"][0]["confidence"] == "low"
