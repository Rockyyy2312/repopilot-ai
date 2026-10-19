import io
import tarfile
import zipfile

import pytest
from fastapi.testclient import TestClient

from app import main as main_module
from app.auth import reset_db
from app.main import MAX_ARCHIVE_BYTES, PROJECTS, app, cleanup_projects

client = TestClient(app)


def setup_function():
    PROJECTS.clear()
    reset_db()
    response = client.post("/api/v1/auth/register", json={"email": "test@example.com", "password": "correct horse battery"})
    assert response.status_code == 200


def archive(name="repo.zip", files=None):
    files = files or {"repo/main.py": "import util\ndef greet(name):\n    return name\n", "repo/util.py": "class Helper:\n    pass\n"}
    out = io.BytesIO()
    if name.endswith(".zip"):
        with zipfile.ZipFile(out, "w") as z:
            for path, content in files.items():
                z.writestr(path, content)
    else:
        with tarfile.open(fileobj=out, mode="w:gz") as tar:
            for path, content in files.items():
                data = content.encode()
                info = tarfile.TarInfo(path)
                info.size = len(data)
                tar.addfile(info, io.BytesIO(data))
    return out.getvalue()


def import_zip(files=None):
    response = client.post("/api/v1/projects/import/archive", files={"file": ("repo.zip", archive(files=files), "application/zip")})
    assert response.status_code == 200
    return response.json()["id"]


def test_archive_path_traversal_rejected():
    response = client.post("/api/v1/projects/import/archive", files={"file": ("bad.zip", archive(files={"../escape.py": "oops"}), "application/zip")})
    assert response.status_code == 400


def test_indexing_tree_read_and_search():
    project_id = import_zip()
    assert client.get(f"/api/v1/projects/{project_id}/tree").json()["files"] == ["repo/main.py", "repo/util.py"]
    assert "def greet" in client.get(f"/api/v1/projects/{project_id}/files/repo/main.py").json()["content"]
    result = client.post(f"/api/v1/projects/{project_id}/search", json={"query": "greet"}).json()
    assert result["results"][0]["path"] == "repo/main.py"


def test_investigation_separates_findings_and_hypotheses():
    project_id = import_zip()
    found = client.post(f"/api/v1/projects/{project_id}/investigate", json={"question": "where is greet", "query": "greet"}).json()
    assert found["findings"][0]["type"] == "finding"
    missing = client.post(f"/api/v1/projects/{project_id}/investigate", json={"question": "why broken", "query": "missing_xyz"}).json()
    assert missing["findings"] == []
    assert missing["hypotheses"][0]["type"] == "hypothesis"


def test_graph_contains_import_evidence():
    project_id = import_zip()
    graph = client.get(f"/api/v1/projects/{project_id}/graph").json()
    edge = next(edge for edge in graph["edges"] if edge["from"] == "repo/main.py")
    assert edge["to"] == "util"
    assert edge["evidence"]["line"] == 1


def test_graph_contains_only_direct_import_relationships():
    project_id = import_zip(files={"src/a.py": "import helpers\ndef run():\n    return helpers.value\n", "src/helpers.py": "value = 1\n"})

    graph = client.get(f"/api/v1/projects/{project_id}/graph").json()

    assert {node["id"] for node in graph["nodes"]} == {"src/a.py", "src/helpers.py"}
    assert len(graph["edges"]) == 1
    assert graph["edges"][0]["from"] == "src/a.py"
    assert graph["edges"][0]["to"] == "helpers"
    assert graph["edges"][0]["evidence"] == {"line": 1, "kind": "import"}


def test_analysis_endpoint_returns_tree_languages_and_limitations():
    project_id = import_zip(files={"src/main.py": "def main():\n    return 1\n", ".env": "TOKEN=secret"})
    result = client.get(f"/api/v1/projects/{project_id}/analysis")

    assert result.status_code == 200
    body = result.json()
    assert body["languages"] == {"python": 1}
    assert body["tree"]["src"]["main.py"]["type"] == "file"
    assert "content" not in body["files"][0]
    assert "TOKEN" not in str(body)


def test_auth_requires_login_and_logout_revokes_project_access():
    PROJECTS.clear()
    reset_db()
    fresh = TestClient(app)
    denied = fresh.post("/api/v1/projects/import/archive", files={"file": ("repo.zip", archive(), "application/zip")})
    assert denied.status_code == 401
    assert fresh.post("/api/v1/auth/register", json={"email": "owner@example.com", "password": "correct horse battery"}).status_code == 200
    project_id = fresh.post("/api/v1/projects/import/archive", files={"file": ("repo.zip", archive(), "application/zip")}).json()["id"]
    assert fresh.post("/api/v1/auth/logout").status_code == 200
    assert fresh.get(f"/api/v1/projects/{project_id}/tree").status_code == 401


def test_users_cannot_access_each_others_projects():
    PROJECTS.clear()
    reset_db()
    first = TestClient(app)
    second = TestClient(app)
    assert first.post("/api/v1/auth/register", json={"email": "one@example.com", "password": "correct horse battery"}).status_code == 200
    project_id = first.post("/api/v1/projects/import/archive", files={"file": ("repo.zip", archive(), "application/zip")}).json()["id"]
    assert second.post("/api/v1/auth/register", json={"email": "two@example.com", "password": "correct horse battery"}).status_code == 200
    assert second.get(f"/api/v1/projects/{project_id}/tree").status_code == 404


@pytest.mark.parametrize(
    "url",
    [
        "http://github.com/owner/repo",
        "https://gitlab.com/owner/repo",
        "https://github.com/owner",
        "https://user:password@github.com/owner/repo",
        "https://github.com/owner/repo?redirect=https://evil.example",
        "https://github.com:443/owner/repo",
    ],
)
def test_github_import_rejects_malformed_unsupported_or_credential_urls(url):
    response = client.post("/api/v1/projects/import/github", json={"url": url})

    assert response.status_code == 400
    assert "github.com/owner/repository" in response.json()["detail"]


def test_github_import_analyzes_successful_public_archive(monkeypatch):
    monkeypatch.setattr(main_module, "fetch_github_archive", lambda owner, repo: archive(files={"repo/main.py": "def main():\n    return 1\n"}))

    response = client.post("/api/v1/projects/import/github", json={"url": "https://github.com/owner/repo"})

    assert response.status_code == 200
    body = response.json()
    assert body["repository_name"] == "repo"
    assert body["languages"] == {"python": 1}
    assert body["symbol_count"] == 1
    assert body["tree"]["repo"]["main.py"]["type"] == "file"


def test_archive_import_rejects_invalid_type_and_malformed_content():
    unsupported = client.post("/api/v1/projects/import/archive", files={"file": ("repo.rar", b"data", "application/octet-stream")})
    malformed = client.post("/api/v1/projects/import/archive", files={"file": ("repo.zip", b"not-a-zip", "application/zip")})

    assert unsupported.status_code == 400
    assert malformed.status_code == 400


def test_archive_import_rejects_compressed_size_limit():
    response = client.post(
        "/api/v1/projects/import/archive",
        files={"file": ("large.zip", b"x" * (MAX_ARCHIVE_BYTES + 1), "application/zip")},
    )

    assert response.status_code == 413


def test_archive_import_rejects_extracted_size_limit(monkeypatch):
    monkeypatch.setattr(main_module, "MAX_EXTRACTED_BYTES", 4)
    response = client.post(
        "/api/v1/projects/import/archive",
        files={"file": ("expanded.zip", archive(files={"repo/main.py": "12345"}), "application/zip")},
    )

    assert response.status_code == 413


def test_archive_import_skips_zip_symlink_entries():
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        info = zipfile.ZipInfo("repo/link.py")
        info.create_system = 3
        info.external_attr = 0o120777 << 16
        z.writestr(info, "../outside.py")
        z.writestr("repo/main.py", "def main():\n    return 1\n")

    response = client.post("/api/v1/projects/import/archive", files={"file": ("links.zip", out.getvalue(), "application/zip")})

    assert response.status_code == 200
    assert response.json()["file_count"] == 1


def test_archive_import_rejects_excessive_member_metadata(monkeypatch):
    monkeypatch.setattr(main_module, "MAX_ARCHIVE_MEMBERS", 1)
    response = client.post("/api/v1/projects/import/archive", files={"file": ("many.zip", archive(files={"a.py": "x", "b.py": "x"}), "application/zip")})

    assert response.status_code == 413


def test_imported_projects_are_cleaned_after_retention_window(monkeypatch):
    PROJECTS["expired"] = {"accessed_at": 0}
    monkeypatch.setattr(main_module, "PROJECT_RETENTION_SECONDS", 1)

    cleanup_projects()

    assert "expired" not in PROJECTS


def test_investigation_endpoint_accepts_error_and_stack_trace_fields():
    project_id = import_zip(files={"app.py": "from missing import Client\n\ndef start():\n    return Client()\n"})
    response = client.post(
        f"/api/v1/projects/{project_id}/investigate",
        json={
            "question": "Why does startup fail?",
            "error_message": "ModuleNotFoundError: No module named 'missing'",
            "stack_trace": 'File "app.py", line 4, in start',
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["summary"]
    assert body["confirmed_evidence"]
    assert body["hypotheses"][0]["confidence"] == "high"


def test_search_supports_empty_queries_paths_symbols_imports_and_ranking():
    project_id = import_zip(
        files={
            "src/main.py": "import helpers\n\ndef run():\n    return 'run'\n\ndef run():\n    return 2\n",
            "src/helpers.py": "class Helper:\n    pass\n",
            "docs/run.md": "run is documented here\n",
        }
    )

    assert client.post(f"/api/v1/projects/{project_id}/search", json={"query": ""}).json()["results"] == []
    path_results = client.post(f"/api/v1/projects/{project_id}/search", json={"query": "helpers.py"}).json()["results"]
    assert path_results[0]["path"] == "src/helpers.py"
    assert path_results[0]["kind"] == "path"
    assert path_results[0]["line"] == 1

    symbol_results = client.post(f"/api/v1/projects/{project_id}/search", json={"query": "run"}).json()["results"]
    assert [item["kind"] for item in symbol_results[:2]] == ["symbol", "symbol"]
    assert [(item["path"], item["line"]) for item in symbol_results[:2]] == [("src/main.py", 3), ("src/main.py", 6)]

    import_results = client.post(f"/api/v1/projects/{project_id}/search", json={"query": "helpers"}).json()["results"]
    assert import_results[0]["kind"] == "import"
    assert import_results[0]["line"] == 1
    assert import_results[0]["language"] == "python"

    scoped = client.post(f"/api/v1/projects/{project_id}/search", json={"query": "run", "path": "docs"}).json()["results"]
    assert [(item["path"], item["line"]) for item in scoped] == [("docs/run.md", 1)]


def test_search_excludes_sensitive_files_and_reports_no_results():
    project_id = import_zip(files={"src/main.py": "def safe():\n    return True\n", ".env": "safe=secret"})

    result = client.post(f"/api/v1/projects/{project_id}/search", json={"query": "secret"}).json()

    assert result["results"] == []


def test_unsafe_origin_is_rejected_for_state_changing_requests():
    response = client.post("/api/v1/auth/logout", headers={"Origin": "https://evil.example"})
    assert response.status_code == 403


def test_project_quota_is_per_user(monkeypatch):
    monkeypatch.setattr(main_module, "MAX_PROJECTS_PER_USER", 1)
    project_id = import_zip()
    assert project_id
    limited = client.post("/api/v1/projects/import/archive", files={"file": ("repo.zip", archive(), "application/zip")})
    assert limited.status_code == 429
