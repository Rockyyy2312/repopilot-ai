import io
import zipfile

from fastapi.testclient import TestClient

from app.auth import CSRF_COOKIE, reset_db
from app.jobs import reset_jobs
from app.main import PROJECTS, app


class BrowserClient(TestClient):
    def request(self, method, url, **kwargs):
        headers = dict(kwargs.pop("headers", {}) or {})
        if method.upper() not in {"GET", "HEAD", "OPTIONS"} and self.cookies.get(CSRF_COOKIE):
            headers.setdefault("X-CSRF-Token", self.cookies.get(CSRF_COOKIE))
        return super().request(method, url, headers=headers, **kwargs)


def setup_function():
    PROJECTS.clear()
    reset_db()
    reset_jobs()


def archive() -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as source:
        source.writestr("repo/app.py", "def greet(name):\n    return f'Hello {name}'\n")
    return output.getvalue()


def logged_in() -> BrowserClient:
    client = BrowserClient(app)
    assert client.post("/api/v1/auth/register", json={"email": "assistant@example.com", "password": "correct horse battery"}).status_code == 200
    assert client.post("/api/v1/auth/login", json={"email": "assistant@example.com", "password": "correct horse battery"}).status_code == 200
    return client


def test_assistant_returns_repository_citations_and_provider_metadata():
    client = logged_in()
    imported = client.post("/api/v1/projects/import/archive", files={"file": ("repo.zip", archive(), "application/zip")})
    project_id = imported.json()["id"]

    response = client.post(f"/api/v1/projects/{project_id}/assistant", json={"question": "Where is greet defined?"})

    assert response.status_code == 200
    body = response.json()
    assert "greet" in body["answer"]
    assert body["provider"] == "deterministic-fallback"
    assert body["citations"][0]["path"] == "repo/app.py"
    assert body["citations"][0]["line_start"] == 1
    assert body["limitations"]


def test_assistant_requires_authentication_and_valid_question():
    client = BrowserClient(app)

    assert client.post("/api/v1/projects/unknown/assistant", json={"question": "hello"}).status_code == 401

    logged = logged_in()
    imported = logged.post("/api/v1/projects/import/archive", files={"file": ("repo.zip", archive(), "application/zip")})
    project_id = imported.json()["id"]
    response = logged.post(f"/api/v1/projects/{project_id}/assistant", json={"question": ""})

    assert response.status_code == 422
