from pathlib import Path

import pytest

from app.analysis.engine import AnalysisConfig, analyze_files, discover_files, safe_relative_path


FIXTURE_ROOT = Path(__file__).parent / "fixtures" / "repository"


def test_discovery_excludes_sensitive_and_generated_directories():
    files, excluded = discover_files(FIXTURE_ROOT)

    assert sorted(files) == ["app.py", "invalid.py", "service.ts", "ui.ts"]
    assert {item["path"] for item in excluded} >= {".env", "node_modules"}


def test_analysis_extracts_python_and_typescript_symbols_and_imports():
    files, excluded = discover_files(FIXTURE_ROOT)
    result = analyze_files(files, excluded=excluded)

    assert result.languages == {"python": 2, "typescript": 2}
    assert [(item.name, item.kind, item.location.path, item.location.line) for item in result.symbols] == [
        ("Service", "class", "app.py", 4),
        ("run", "function", "app.py", 5),
        ("build_service", "function", "app.py", 9),
        ("Service", "class", "service.ts", 1),
        ("createClient", "const", "ui.ts", 2),
        ("renderApp", "function", "ui.ts", 3),
    ]
    assert [(item.module, item.location.path, item.location.line) for item in result.imports] == [
        ("helpers", "app.py", 1),
        ("./service", "ui.ts", 1),
    ]
    assert result.tree["app.py"]["type"] == "file"


def test_invalid_source_is_reported_without_execution():
    files, _ = discover_files(FIXTURE_ROOT)
    result = analyze_files(files)
    invalid = next(item for item in result.files if item.path == "invalid.py")

    assert invalid.status == "invalid"
    assert invalid.symbols == []
    assert "parser rejected" in invalid.limitation.lower()


def test_unsupported_source_remains_searchable_with_limitation():
    result = analyze_files({"notes.md": "class-shaped text"})

    assert result.files[0].status == "unsupported"
    assert result.files[0].content == "class-shaped text"
    assert result.files[0].symbols == []


def test_limits_reject_oversized_and_excess_files():
    result = analyze_files({"large.py": "12345", "other.py": "x"}, AnalysisConfig(max_files=1, max_file_bytes=4))

    assert [item.path for item in result.files] == ["other.py"]
    assert result.errors == [{"path": "large.py", "reason": "file exceeds configured size limit"}]

    limited = analyze_files({"a.py": "a", "b.py": "b"}, AnalysisConfig(max_files=1, max_file_bytes=4))
    assert [item.path for item in limited.files] == ["a.py"]
    assert limited.errors == [{"path": "b.py", "reason": "file count limit reached"}]


@pytest.mark.parametrize("path", ["../escape.py", "/absolute.py", "dir/../escape.py", "", "safe\x00.py"])
def test_relative_path_validation_rejects_traversal(path):
    with pytest.raises(ValueError):
        safe_relative_path(path)


def test_analysis_config_rejects_invalid_limits():
    with pytest.raises(ValueError):
        AnalysisConfig(max_files=0)
    with pytest.raises(ValueError):
        AnalysisConfig(max_file_bytes=0)
