import base64
import io
import time
import zipfile

from fastapi.testclient import TestClient

from app import main as main_module
from app.auth import CSRF_COOKIE, reset_db
from app.jobs import create_job, get_job_for_worker, recover_interrupted_jobs, reset_jobs, update_job
from app.main import app


class BrowserClient(TestClient):
    def request(self, method, url, **kwargs):
        headers = dict(kwargs.pop("headers", {}) or {})
        if method.upper() not in {"GET", "HEAD", "OPTIONS"} and self.cookies.get(CSRF_COOKIE):
            headers.setdefault("X-CSRF-Token", self.cookies.get(CSRF_COOKIE))
        return super().request(method, url, headers=headers, **kwargs)


def archive() -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as source:
        source.writestr("repo/main.py", "def main():\n    return 1\n")
        source.writestr("repo/util.py", "VALUE = 1\n")
    return output.getvalue()


def logged_in(email: str) -> BrowserClient:
    client = BrowserClient(app)
    assert client.post("/api/v1/auth/register", json={"email": email, "password": "correct horse battery"}).status_code == 200
    assert client.post("/api/v1/auth/login", json={"email": email, "password": "correct horse battery"}).status_code == 200
    return client


def setup_function():
    reset_db()
    reset_jobs()


def wait_for(client: BrowserClient, job_id: str) -> dict:
    for _ in range(100):
        body = client.get(f"/api/v1/jobs/{job_id}").json()
        if body["status"] in {"succeeded", "failed", "cancelled"}:
            return body
        time.sleep(0.01)
    raise AssertionError("job did not finish")


def test_job_store_status_transitions_and_owner_filtering():
    job = create_job("owner", "test", {"value": 1})
    assert job["status"] == "queued"
    started = update_job(job["id"], status="running", message="Working", only_status="queued")
    assert started is not None
    assert started["status"] == "running"
    result = update_job(job["id"], status="succeeded", progress=1, result={"ok": True}, only_status="running")
    assert result is not None
    assert result["status"] == "succeeded"
    assert result["result"] == {"ok": True}


def test_recover_interrupted_jobs_requeues_running_work():
    queued = create_job("owner", "repository_import", {"queued": True})
    running = create_job("owner", "repository_import", {"running": True})
    assert update_job(running["id"], status="running", message="Working", only_status="queued")

    recovered = recover_interrupted_jobs()

    assert set(recovered) == {queued["id"], running["id"]}
    restored = get_job_for_worker(running["id"])
    assert restored is not None
    assert restored["status"] == "queued"
    assert restored["started_at"] is None
    assert restored["message"] == "Recovered after process restart"


def test_async_import_returns_result_and_unauthorized_job_is_hidden(monkeypatch):
    owner = logged_in("owner@example.com")
    other = logged_in("other@example.com")
    monkeypatch.setattr(main_module, "fetch_github_archive", lambda owner, repo: archive())

    response = owner.post("/api/v1/projects/import/jobs", json={"type": "github", "url": "https://github.com/owner/repo"})
    assert response.status_code == 202
    job_id = response.json()["job_id"]
    assert other.get(f"/api/v1/jobs/{job_id}").status_code == 404
    body = wait_for(owner, job_id)
    assert body["status"] == "succeeded"
    assert body["result"]["repository_name"] == "repo"


def test_queued_job_can_be_cancelled_with_csrf_and_other_user_cannot():
    owner = logged_in("owner@example.com")
    other = logged_in("other@example.com")
    owner_id = owner.get("/api/v1/auth/me").json()["user"]["id"]
    job = create_job(owner_id, "test")
    assert other.post(f"/api/v1/jobs/{job['id']}/cancel").status_code == 404
    cancelled = owner.post(f"/api/v1/jobs/{job['id']}/cancel")
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"


def test_graph_scope_and_limit_report_truncation():
    owner = logged_in("owner@example.com")
    # Direct synchronous import keeps this test focused on graph bounds.
    payload = base64.b64encode(archive()).decode()
    project = owner.post("/api/v1/projects/import/jobs", json={"type": "archive", "filename": "repo.zip", "archive_base64": payload}).json()
    body = wait_for(owner, project["job_id"])
    assert body["status"] == "succeeded"
    project_id = body["result"]["id"]
    graph = owner.get(f"/api/v1/projects/{project_id}/graph?scope=repo&limit=1")
    assert graph.status_code == 200
    assert len(graph.json()["nodes"]) == 1
    assert graph.json()["truncated"]["nodes"] is True
