import io
import zipfile

from fastapi.testclient import TestClient

from app.auth import CSRF_COOKIE, reset_db
from app.main import PROJECTS, app


class BrowserTestClient(TestClient):
    def request(self, method, url, **kwargs):
        headers = dict(kwargs.pop("headers", {}) or {})
        if method.upper() not in {"GET", "HEAD", "OPTIONS"}:
            token = self.cookies.get(CSRF_COOKIE)
            if token:
                headers.setdefault("X-CSRF-Token", token)
        return super().request(method, url, headers=headers, **kwargs)


def archive(files):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as source:
        for path, content in files.items():
            source.writestr(path, content)
    return output.getvalue()


def setup_client():
    PROJECTS.clear()
    reset_db()
    client = BrowserTestClient(app)
    assert client.post("/api/v1/auth/register", json={"email": "workspace@example.com", "password": "correct horse battery"}).status_code == 200
    assert client.post("/api/v1/auth/login", json={"email": "workspace@example.com", "password": "correct horse battery"}).status_code == 200
    return client


def import_project(client):
    response = client.post("/api/v1/projects/import/archive", files={"file": ("repo.zip", archive({
        "src/main.py": "import requests\n\ndef run():\n    return requests.get('x')\n",
        "package.json": '{"dependencies":{"requests":"^1.2.0"}}',
        "requirements.txt": "requests>=2.0\n",
    }), "application/zip")})
    assert response.status_code == 200
    return response.json()["id"]


def test_overview_uses_snapshot_content_and_safe_dependency_declarations():
    client = setup_client()
    project_id = import_project(client)
    response = client.get(f"/api/v1/projects/{project_id}/overview")

    assert response.status_code == 200
    body = response.json()
    assert body["project_id"] == project_id
    assert body["indexed_at"] > 0
    assert body["total_lines"] == 6
    assert body["total_bytes"] > 0
    assert {item["name"] for item in body["languages"]} == {"python", "unknown"}
    assert any(item["name"] == "requests" and item["version"] == "^1.2.0" for item in body["dependencies"])
    assert all("resolved" not in item["version"] for item in body["dependencies"])


def test_preferences_are_private_and_patch_persists():
    client = setup_client()
    assert client.get("/api/v1/users/me/preferences").json() == {"display_name": "", "reduced_motion": False, "compact_mode": False}
    updated = client.patch("/api/v1/users/me/preferences", json={"display_name": "  Ada  ", "compact_mode": True})
    assert updated.status_code == 200
    assert updated.json() == {"display_name": "Ada", "reduced_motion": False, "compact_mode": True}
    assert client.get("/api/v1/users/me/preferences").json()["compact_mode"] is True


def test_search_page_filters_and_reports_metadata():
    client = setup_client()
    project_id = import_project(client)
    response = client.post(f"/api/v1/projects/{project_id}/search", json={"query": "run", "language": "python", "kind": "symbol", "limit": 1})
    body = response.json()
    assert response.status_code == 200
    assert body["total_matches"] == 1
    assert body["total_files"] == 1
    assert body["has_more"] is False
    assert body["results"][0]["kind"] == "symbol"
    assert isinstance(body["elapsed_ms"], (int, float))


def test_question_only_investigation_labels_source_as_candidate_context():
    client = setup_client()
    project_id = import_project(client)
    response = client.post(f"/api/v1/projects/{project_id}/investigate", json={"question": "Where is the requests client used?"})
    assert response.status_code == 200
    body = response.json()
    assert body["confirmed_evidence"]
    assert any("candidate context" in item for item in body["limitations"])
    assert all("cause" not in item["text"].casefold() for item in body["confirmed_evidence"])
