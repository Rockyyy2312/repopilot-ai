import io
import tarfile
import zipfile

from fastapi.testclient import TestClient

from app.main import PROJECTS, app

client = TestClient(app)


def setup_function():
    PROJECTS.clear()


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


def test_analysis_endpoint_returns_tree_languages_and_limitations():
    project_id = import_zip(files={"src/main.py": "def main():\n    return 1\n", ".env": "TOKEN=secret"})
    result = client.get(f"/api/v1/projects/{project_id}/analysis")

    assert result.status_code == 200
    body = result.json()
    assert body["languages"] == {"python": 1}
    assert body["tree"]["src"]["main.py"]["type"] == "file"
    assert "content" not in body["files"][0]
    assert "TOKEN" not in str(body)
