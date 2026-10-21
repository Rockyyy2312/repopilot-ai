from __future__ import annotations

import io
import hashlib
import hmac
import json
import secrets
import os
import threading
import re
import tarfile
import time
import uuid
import urllib.request
import urllib.parse
import urllib.error
import zipfile
import base64
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from fastapi import Cookie, Depends, FastAPI, File, HTTPException, Query, Request, Response, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.analysis import AnalysisConfig, analyze_files
from app.analysis.engine import ANALYSIS_VERSION, is_sensitive, safe_relative_path
from app.analysis.models import AnalysisResult, FileAnalysis, ImportRelation, SourceLocation, Symbol
from app.investigation import investigate as run_investigation
from app.search import SearchRequest, search_index
from app.workspace import workspace_router
from app.project_store import count_projects, delete_expired, delete_project, list_projects as stored_projects, load_project, save_project, touch_project
from app.auth import APP_ENV, CSRF_COOKIE, SECURE_COOKIES, SESSION_COOKIE, SESSION_TTL, User, authenticate, create_session, create_user, delete_session, get_user
from app.graph import build_graph
from app.jobs import cancel_job, create_job, get_job, get_job_for_worker, update_job

MAX_ARCHIVE_BYTES = 25 * 1024 * 1024
MAX_FILES = 5000
MAX_FILE_BYTES = 2 * 1024 * 1024
MAX_EXTRACTED_BYTES = 50 * 1024 * 1024
MAX_ARCHIVE_MEMBERS = MAX_FILES * 2
MAX_SEARCH_RESULTS = 100
GITHUB_DOWNLOAD_TIMEOUT = 15
PROJECT_RETENTION_SECONDS = 60 * 60
MAX_PROJECTS = 100
MAX_PROJECTS_PER_USER = 10
MAX_IMPORTS_PER_MINUTE = 6
MAX_IMPORTS_IN_FLIGHT_PER_USER = 1
MAX_REQUEST_BYTES = 30 * 1024 * 1024
MAX_GRAPH_DEPTH = 25
MAX_GRAPH_LIMIT = 10000
ALLOWED_ORIGINS = {item.strip() for item in os.environ.get("REPOPILOT_ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if item.strip()}
ANALYSIS_CONFIG = AnalysisConfig(
    max_files=int(os.environ.get("REPOPILOT_MAX_FILES", MAX_FILES)),
    max_file_bytes=int(os.environ.get("REPOPILOT_MAX_FILE_BYTES", MAX_FILE_BYTES)),
)

app = FastAPI(title="RepoPilot AI", version="0.1.0")

@app.middleware("http")
async def security_middleware(request: Request, call_next):
    content_length = request.headers.get("content-length")
    if content_length and request.url.path.endswith("/projects/import/archive"):
        try:
            if int(content_length) > MAX_REQUEST_BYTES:
                return JSONResponse({"detail": "request body exceeds import limit"}, status_code=413)
        except ValueError:
            return JSONResponse({"detail": "invalid content length"}, status_code=400)
    unsafe = request.method not in {"GET", "HEAD", "OPTIONS"}
    if unsafe:
        origin = request.headers.get("origin")
        if origin and origin not in ALLOWED_ORIGINS:
            return JSONResponse({"detail": "origin not allowed"}, status_code=403)
        exempt = {"/api/v1/auth/login", "/api/v1/auth/register", "/api/v1/health"}
        if request.url.path not in exempt and request.cookies.get(SESSION_COOKIE):
            cookie_token = request.cookies.get(CSRF_COOKIE)
            header_token = request.headers.get("x-csrf-token")
            if not cookie_token or not header_token or not hmac.compare_digest(cookie_token, header_token):
                return JSONResponse({"detail": "csrf validation failed"}, status_code=403)
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "same-origin")
    response.headers.setdefault("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self'")
    if APP_ENV == "production":
        response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    return response

PROJECTS: dict[str, dict[str, Any]] = {}
IMPORT_STATE_LOCK = threading.Lock()
IMPORT_TIMES: dict[str, list[float]] = {}
IMPORT_IN_FLIGHT: dict[str, int] = {}
# This executor is deliberately bounded and process-local. It is suitable for a
# single-process deployment only; it is not a claim of durable/distributed workers.
IMPORT_JOB_EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="repopilot-import")


class GithubImport(BaseModel):
    url: str


class ImportJobRequest(BaseModel):
    """Metadata for an asynchronous import; archive bytes may be base64 encoded."""
    type: str | None = None
    source_type: str | None = None
    url: str | None = None
    filename: str | None = None
    archive_base64: str | None = None
    data: str | None = None
    source: dict[str, Any] | None = None


class AuthRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=10, max_length=200)

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        normalized = value.strip().casefold()
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", normalized):
            raise ValueError("a valid email address is required")
        return normalized


class InvestigationRequest(BaseModel):
    question: str = Field(min_length=1, max_length=1000)
    error_message: str = Field(default="", max_length=2000)
    stack_trace: str = Field(default="", max_length=10000)
    file: str | None = Field(default=None, max_length=500)
    symbol: str | None = Field(default=None, max_length=200)
    query: str | None = Field(default=None, max_length=200)


def fetch_github_archive(owner: str, repo: str) -> bytes:
    metadata_request = urllib.request.Request(
        f"https://api.github.com/repos/{owner}/{repo}",
        headers={"Accept": "application/vnd.github+json", "User-Agent": "RepoPilot-AI/0.1"},
    )
    try:
        opener = urllib.request.build_opener(_NoRedirectHandler())
        with opener.open(metadata_request, timeout=GITHUB_DOWNLOAD_TIMEOUT) as response:
            metadata = json.loads(response.read(128 * 1024).decode("utf-8"))
        branch = metadata.get("default_branch")
        if not isinstance(branch, str) or not re.fullmatch(r"[^\x00-\x1f]{1,250}", branch):
            raise HTTPException(502, "GitHub did not return a usable default branch")
        archive_url = f"https://codeload.github.com/{owner}/{repo}/zip/refs/heads/{urllib.parse.quote(branch, safe='')}"
    except HTTPException:
        raise
    except urllib.error.HTTPError as exc:
        status = 404 if exc.code == 404 else 429 if exc.code == 403 else 502
        message = "public GitHub repository was not found" if status == 404 else "GitHub request was rate limited" if status == 429 else "unable to resolve the public GitHub repository"
        raise HTTPException(status, message) from exc
    except Exception as exc:
        raise HTTPException(502, "unable to resolve the public GitHub repository") from exc
    request = urllib.request.Request(archive_url, headers={"User-Agent": "RepoPilot-AI/0.1"})
    try:
        with opener.open(request, timeout=GITHUB_DOWNLOAD_TIMEOUT) as response:
            content_length = response.headers.get("Content-Length")
            if content_length and int(content_length) > MAX_ARCHIVE_BYTES:
                raise HTTPException(413, "repository archive exceeds size limit")
            data = response.read(MAX_ARCHIVE_BYTES + 1)
    except HTTPException:
        raise
    except urllib.error.HTTPError as exc:
        status = 404 if exc.code == 404 else 429 if exc.code == 403 else 502
        message = "public GitHub repository archive was not found" if status == 404 else "GitHub request was rate limited" if status == 429 else "unable to download the public GitHub repository"
        raise HTTPException(status, message) from exc
    except Exception as exc:
        raise HTTPException(502, "unable to download the public GitHub repository") from exc
    if len(data) > MAX_ARCHIVE_BYTES:
        raise HTTPException(413, "repository archive exceeds size limit")
    return data


class _NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request: Any, fp: Any, code: int, msg: str, headers: Any, newurl: str) -> None:
        raise OSError("redirects are not permitted")


def safe_path(path: str) -> str:
    try:
        return safe_relative_path(path)
    except ValueError as exc:
        raise HTTPException(400, "invalid path") from exc


def validate_github_url(url: str) -> tuple[str, str]:
    parsed = urlsplit(url)
    try:
        has_nonstandard_port = parsed.port is not None
    except ValueError:
        has_nonstandard_port = True
    if parsed.scheme != "https" or parsed.hostname != "github.com" or parsed.username or parsed.password or parsed.query or parsed.fragment or has_nonstandard_port:
        raise HTTPException(400, "url must be a public https://github.com/owner/repository URL")
    m = re.fullmatch(r"/([A-Za-z0-9_.-]{1,100})/([A-Za-z0-9_.-]{1,100})(?:\.git)?/?", parsed.path)
    if not m:
        raise HTTPException(400, "url must be a public https://github.com/owner/repository URL")
    return m.group(1), m.group(2).removesuffix(".git")


def extract_archive(data: bytes, filename: str) -> dict[str, str]:
    if len(data) > MAX_ARCHIVE_BYTES:
        raise HTTPException(413, "archive exceeds size limit")
    files: dict[str, str] = {}
    extracted_bytes = 0
    try:
        if filename.lower().endswith(".zip"):
            source = zipfile.ZipFile(io.BytesIO(data))
            if len(source.infolist()) > MAX_ARCHIVE_MEMBERS:
                raise HTTPException(413, "archive contains too many entries")
            members = [(i.filename, not i.is_dir() and not _zip_info_is_symlink(i), lambda i=i: source.open(i)) for i in source.infolist()]
        elif filename.lower().endswith((".tar.gz", ".tgz", ".tar")):
            source = tarfile.open(fileobj=io.BytesIO(data), mode="r:*")
            archive_members = source.getmembers()
            if len(archive_members) > MAX_ARCHIVE_MEMBERS:
                raise HTTPException(413, "archive contains too many entries")
            members = [(i.name, i.isfile(), lambda i=i: source.extractfile(i)) for i in archive_members]
        else:
            raise HTTPException(400, "archive must be .zip, .tar, or .tar.gz")
        for name, regular, opener in members:
            if not regular:
                continue
            clean = safe_path(name)
            if is_sensitive(clean):
                continue
            if len(files) >= MAX_FILES:
                raise HTTPException(413, "archive contains too many files")
            handle = opener()
            if handle is None:
                continue
            content = handle.read(MAX_FILE_BYTES + 1)
            if len(content) > MAX_FILE_BYTES:
                raise HTTPException(413, f"file exceeds size limit: {clean}")
            extracted_bytes += len(content)
            if extracted_bytes > MAX_EXTRACTED_BYTES:
                raise HTTPException(413, "archive extracted size exceeds limit")
            try:
                files[clean] = content.decode("utf-8")
            except UnicodeDecodeError:
                continue
        source.close()
    except (zipfile.BadZipFile, tarfile.TarError, OSError) as exc:
        raise HTTPException(400, "invalid archive") from exc
    return files


def _zip_info_is_symlink(info: zipfile.ZipInfo) -> bool:
    mode = (info.external_attr >> 16) & 0o170000
    return mode == 0o120000


def symbol_to_dict(symbol: Any) -> dict[str, Any]:
    return {"name": symbol.name, "kind": symbol.kind, "path": symbol.location.path, "line": symbol.location.line}


def import_to_dict(relation: Any) -> dict[str, Any]:
    return {"module": relation.module, "path": relation.location.path, "line": relation.location.line}


def repository_name(source: dict[str, Any]) -> str:
    if source.get("type") == "github":
        return str(source.get("repo") or "uploaded-repository")
    return str(source.get("filename") or "uploaded-repository")


def analysis_input_hash(files: dict[str, str], source: dict[str, Any]) -> str:
    payload = {
        "version": ANALYSIS_VERSION,
        "source": source,
        "files": files,
        "config": {
            "max_files": ANALYSIS_CONFIG.max_files,
            "max_file_bytes": ANALYSIS_CONFIG.max_file_bytes,
            "excluded_dirs": sorted(ANALYSIS_CONFIG.excluded_dirs),
        },
    }
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def analysis_from_cache(value: Any) -> AnalysisResult | None:
    if not isinstance(value, dict):
        return None
    try:
        def location(item: dict[str, Any]) -> SourceLocation:
            return SourceLocation(str(item["path"]), int(item["line"]))

        def symbol(item: dict[str, Any]) -> Symbol:
            return Symbol(str(item["name"]), str(item["kind"]), location(item["location"]))

        def relation(item: dict[str, Any]) -> ImportRelation:
            return ImportRelation(str(item["module"]), location(item["location"]))

        files = []
        for item in value["files"]:
            files.append(FileAnalysis(
                str(item["path"]), item.get("language"), int(item["size"]), str(item.get("content", "")),
                [symbol(entry) for entry in item.get("symbols", [])],
                [relation(entry) for entry in item.get("imports", [])],
                str(item.get("status", "analyzed")), item.get("limitation"),
            ))
        return AnalysisResult(
            files, value["tree"], {str(key): int(count) for key, count in value["languages"].items()},
            [symbol(item) for item in value.get("symbols", [])],
            [relation(item) for item in value.get("imports", [])],
            list(value.get("excluded", [])), list(value.get("errors", [])),
        )
    except (KeyError, TypeError, ValueError, AttributeError):
        return None


def set_analysis_cache(project: dict[str, Any], result: AnalysisResult) -> None:
    warnings = result.excluded + result.errors + [
        {"path": item.path, "reason": item.limitation or ""}
        for item in result.files if item.limitation
    ]
    project["analysis"] = result
    project["index"] = {
        "symbols": [symbol_to_dict(item) for item in result.symbols],
        "imports": [import_to_dict(item) for item in result.imports],
    }
    project["analysis_version"] = ANALYSIS_VERSION
    project["analysis_input_hash"] = analysis_input_hash(project["files"], project["source"])
    project["analysis_cache_json"] = result.to_dict(include_content=True)
    project["summary"] = {
        "repository_name": repository_name(project["source"]),
        "file_count": len(project["files"]),
        "symbol_count": len(result.symbols),
        "import_count": len(result.imports),
        "languages": result.languages,
        "warning_count": len(warnings),
    }


def ensure_analysis(project: dict[str, Any]) -> None:
    expected_hash = analysis_input_hash(project["files"], project["source"])
    if project.get("analysis_version") == ANALYSIS_VERSION and project.get("analysis_input_hash") == expected_hash:
        cached = analysis_from_cache(project.get("analysis_cache_json"))
        if cached is not None:
            project["analysis"] = cached
            project["index"] = {
                "symbols": [symbol_to_dict(item) for item in cached.symbols],
                "imports": [import_to_dict(item) for item in cached.imports],
            }
            return
    set_analysis_cache(project, analyze_files(project["files"], ANALYSIS_CONFIG))
    save_project(project)



def reserve_import(user_id: str) -> None:
    now = time.time()
    with IMPORT_STATE_LOCK:
        timestamps = [item for item in IMPORT_TIMES.get(user_id, []) if now - item < 60]
        if len(timestamps) >= MAX_IMPORTS_PER_MINUTE:
            raise HTTPException(429, "import rate limit reached; try again later")
        if IMPORT_IN_FLIGHT.get(user_id, 0) >= MAX_IMPORTS_IN_FLIGHT_PER_USER:
            raise HTTPException(429, "another import is already being processed")
        if count_projects(user_id) >= MAX_PROJECTS_PER_USER:
            raise HTTPException(429, "project quota reached; remove an existing project before importing another")
        timestamps.append(now)
        IMPORT_TIMES[user_id] = timestamps
        IMPORT_IN_FLIGHT[user_id] = IMPORT_IN_FLIGHT.get(user_id, 0) + 1


def release_import(user_id: str) -> None:
    with IMPORT_STATE_LOCK:
        remaining = IMPORT_IN_FLIGHT.get(user_id, 0) - 1
        if remaining > 0:
            IMPORT_IN_FLIGHT[user_id] = remaining
        else:
            IMPORT_IN_FLIGHT.pop(user_id, None)


def create_project(files: dict[str, str], source: dict[str, Any], user_id: str = "anonymous") -> dict[str, Any]:
    cleanup_projects()
    project_id = uuid.uuid4().hex
    result = analyze_files(files, ANALYSIS_CONFIG)
    project = {
        "id": project_id,
        "files": {item.path: item.content for item in result.files},
        "analysis": result,
        "index": {"symbols": [symbol_to_dict(item) for item in result.symbols], "imports": [import_to_dict(item) for item in result.imports]},
        "source": source,
        "user_id": user_id,
        "created_at": time.time(),
        "accessed_at": time.time(),
    }
    if not project["files"]:
        raise HTTPException(422, "repository contains no analyzable UTF-8 files")
    if count_projects(user_id) >= MAX_PROJECTS_PER_USER:
        raise HTTPException(429, "project quota reached; remove an existing project before importing another")
    set_analysis_cache(project, result)
    save_project(project)
    PROJECTS[project_id] = project
    while len(PROJECTS) > MAX_PROJECTS:
        oldest = min(PROJECTS, key=lambda item: PROJECTS[item].get("accessed_at", 0))
        del PROJECTS[oldest]
    return project


def cleanup_projects() -> None:
    cutoff = time.time() - PROJECT_RETENTION_SECONDS
    for project_id, project in list(PROJECTS.items()):
        if project.get("accessed_at", project.get("created_at", 0)) < cutoff:
            del PROJECTS[project_id]
    delete_expired(cutoff)


def import_response(project: dict[str, Any]) -> dict[str, Any]:
    result = project["analysis"]
    warnings = result.excluded + result.errors + [{"path": item.path, "reason": item.limitation or ""} for item in result.files if item.limitation]
    return {
        "id": project["id"],
        "repository_name": repository_name(project["source"]),
        "source": project["source"],
        "file_count": len(project["files"]),
        "languages": result.languages,
        "symbol_count": len(result.symbols),
        "import_count": len(result.imports),
        "tree": result.tree,
        "warnings": warnings,
        "analysis": result.to_dict(include_content=False),
        "index": project["index"],
    }


def _job_payload(payload: ImportJobRequest | dict[str, Any]) -> dict[str, Any]:
    values = payload.model_dump() if isinstance(payload, ImportJobRequest) else dict(payload)
    nested = values.get("source") if isinstance(values.get("source"), dict) else {}
    source_type = values.get("type") or values.get("source_type") or nested.get("type")
    source_type = str(source_type or ("github" if values.get("url") or nested.get("url") else "archive")).lower()
    if source_type not in {"github", "archive"}:
        raise HTTPException(400, "import type must be github or archive")
    url = values.get("url") or nested.get("url")
    filename = values.get("filename") or nested.get("filename") or "uploaded-repository.zip"
    encoded = values.get("archive_base64") or values.get("data") or nested.get("archive_base64") or nested.get("data")
    if source_type == "github":
        if not isinstance(url, str):
            raise HTTPException(400, "github import jobs require a url")
        owner, repo = validate_github_url(url)
        return {"type": "github", "url": url, "owner": owner, "repo": repo}
    if not isinstance(encoded, str):
        raise HTTPException(400, "archive import jobs require archive_base64 metadata")
    try:
        data = base64.b64decode(encoded, validate=True)
    except (ValueError, base64.binascii.Error) as exc:
        raise HTTPException(400, "archive_base64 must be valid base64") from exc
    if len(data) > MAX_ARCHIVE_BYTES:
        raise HTTPException(413, "archive exceeds size limit")
    if not isinstance(filename, str) or not filename:
        raise HTTPException(400, "archive filename is required")
    return {"type": "archive", "filename": filename[:250], "archive_base64": encoded}


def _job_is_cancelled(job_id: str) -> bool:
    job = get_job_for_worker(job_id)
    return not job or job["status"] == "cancelled"


def _run_import_job(job_id: str) -> None:
    job = get_job_for_worker(job_id)
    if not job or job["status"] != "queued":
        return
    if update_job(job_id, status="running", progress=0.05, message="Preparing import", only_status="queued") is None:
        return
    job = get_job_for_worker(job_id)
    if not job:
        return
    payload = job["payload"]
    # The worker-only record includes ownership; public job responses intentionally omit it.
    user_id = job.get("user_id")
    if not user_id:
        update_job(job_id, status="failed", message="Import owner is unavailable", error="job owner not found", only_status="running")
        return
    reserved = False
    try:
        reserve_import(user_id)
        reserved = True
        if _job_is_cancelled(job_id):
            return
        if payload["type"] == "github":
            update_job(job_id, progress=0.2, message="Downloading public GitHub repository")
            data = fetch_github_archive(payload["owner"], payload["repo"])
            files = extract_archive(data, f"{payload['repo']}.zip")
            source = {"type": "github", "url": payload["url"], "owner": payload["owner"], "repo": payload["repo"]}
        else:
            update_job(job_id, progress=0.2, message="Reading archive")
            data = base64.b64decode(payload["archive_base64"], validate=True)
            files = extract_archive(data, payload["filename"])
            source = {"type": "archive", "filename": payload["filename"]}
        if _job_is_cancelled(job_id):
            return
        update_job(job_id, progress=0.65, message="Analyzing repository")
        project = create_project(files, source, user_id)
        result = import_response(project)
        update_job(job_id, status="succeeded", progress=1, message="Import completed", result=result, only_status="running")
    except Exception as exc:
        if not _job_is_cancelled(job_id):
            detail = exc.detail if isinstance(exc, HTTPException) else str(exc)
            update_job(job_id, status="failed", progress=1, message="Import failed", error=str(detail), only_status="running")
    finally:
        if reserved:
            release_import(user_id)


def current_user(session: str | None = Cookie(default=None, alias=SESSION_COOKIE)) -> User:
    user = get_user(session)
    if not user:
        raise HTTPException(401, "authentication required")
    return user


def get_project(project_id: str, user: User) -> dict[str, Any]:
    cleanup_projects()
    project = PROJECTS.get(project_id)
    if not project:
        stored = load_project(project_id)
        if stored:
            PROJECTS[project_id] = stored
            project = stored
    if not project:
        raise HTTPException(404, "project not found")
    if project.get("user_id") != user.id:
        raise HTTPException(404, "project not found")
    ensure_analysis(project)
    PROJECTS[project_id] = project
    project["accessed_at"] = time.time()
    touch_project(project_id, project["accessed_at"])
    return project


def user_response(user: User) -> dict[str, str]:
    return {"id": user.id, "email": user.email}


@app.get("/api/v1/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/v1/auth/me")
def auth_me(session: str | None = Cookie(default=None, alias=SESSION_COOKIE)) -> dict[str, Any]:
    user = get_user(session)
    return {"authenticated": bool(user), "user": user_response(user) if user else None}


def set_auth_cookies(response: Response, user_id: str) -> None:
    response.set_cookie(SESSION_COOKIE, create_session(user_id), httponly=True, samesite="lax", max_age=SESSION_TTL, secure=SECURE_COOKIES)
    response.set_cookie(CSRF_COOKIE, secrets.token_urlsafe(32), httponly=False, samesite="lax", max_age=SESSION_TTL, secure=SECURE_COOKIES)


@app.post("/api/v1/auth/register")
def auth_register(payload: AuthRequest) -> dict[str, Any]:
    try:
        user = create_user(payload.email, payload.password)
    except ValueError as exc:
        raise HTTPException(409, "registration could not be completed") from exc
    return {"registered": True, "email": user.email}


@app.post("/api/v1/auth/login")
def auth_login(payload: AuthRequest, response: Response) -> dict[str, Any]:
    user = authenticate(payload.email, payload.password)
    if not user:
        raise HTTPException(401, "invalid email or password")
    set_auth_cookies(response, user.id)
    return {"user": user_response(user)}


@app.post("/api/v1/auth/logout")
def auth_logout(response: Response, session: str | None = Cookie(default=None, alias=SESSION_COOKIE)) -> dict[str, bool]:
    delete_session(session)
    response.delete_cookie(SESSION_COOKIE, secure=SECURE_COOKIES, samesite="lax")
    response.delete_cookie(CSRF_COOKIE, secure=SECURE_COOKIES, samesite="lax")
    return {"ok": True}


@app.post("/api/v1/projects/import/jobs", status_code=202)
async def import_job(request: Request, user: User = Depends(current_user)) -> dict[str, Any]:
    """Queue GitHub metadata or an uploaded archive for the bounded local worker."""
    content_type = request.headers.get("content-type", "")
    if content_type.lower().startswith("multipart/"):
        form = await request.form()
        raw: dict[str, Any] = {key: value for key, value in form.items() if key != "file" and isinstance(value, str)}
        upload = form.get("file")
        if isinstance(upload, UploadFile):
            data = await upload.read(MAX_ARCHIVE_BYTES + 1)
            await upload.close()
            if len(data) > MAX_ARCHIVE_BYTES:
                raise HTTPException(413, "archive exceeds size limit")
            raw["type"] = raw.get("type") or "archive"
            raw["filename"] = upload.filename or raw.get("filename") or "uploaded-repository.zip"
            raw["archive_base64"] = base64.b64encode(data).decode("ascii")
        elif raw.get("type") == "archive":
            raise HTTPException(400, "archive upload is required")
    else:
        try:
            raw = await request.json()
        except Exception as exc:
            raise HTTPException(400, "expected JSON import metadata") from exc
        if not isinstance(raw, dict):
            raise HTTPException(400, "expected an import metadata object")
    payload = _job_payload(raw)
    job = create_job(user.id, "repository_import", payload)
    IMPORT_JOB_EXECUTOR.submit(_run_import_job, job["id"])
    return {"job_id": job["id"], **job}


@app.get("/api/v1/jobs/{job_id}")
def job_status(job_id: str, user: User = Depends(current_user)) -> dict[str, Any]:
    job = get_job(job_id, user.id)
    if not job:
        raise HTTPException(404, "job not found")
    return job


@app.post("/api/v1/jobs/{job_id}/cancel")
def job_cancel(job_id: str, user: User = Depends(current_user)) -> dict[str, Any]:
    job = cancel_job(job_id, user.id)
    if not job:
        raise HTTPException(404, "job not found")
    return job


@app.post("/api/v1/projects/import/github")
def import_github(payload: GithubImport, user: User = Depends(current_user)) -> dict[str, Any]:
    reserve_import(user.id)
    try:
        owner, repo = validate_github_url(payload.url)
        data = fetch_github_archive(owner, repo)
        files = extract_archive(data, f"{repo}.zip")
        project = create_project(files, {"type": "github", "url": payload.url, "owner": owner, "repo": repo}, user.id)
        return import_response(project)
    finally:
        release_import(user.id)


@app.post("/api/v1/projects/import/archive")
async def import_archive(file: UploadFile = File(...), user: User = Depends(current_user)) -> dict[str, Any]:
    reserve_import(user.id)
    try:
        data = await file.read(MAX_ARCHIVE_BYTES + 1)
        project = create_project(extract_archive(data, file.filename or ""), {"type": "archive", "filename": file.filename}, user.id)
        return import_response(project)
    finally:
        await file.close()
        release_import(user.id)


@app.get("/api/v1/projects")
def project_list(user: User = Depends(current_user)) -> dict[str, Any]:
    cleanup_projects()
    return {"projects": stored_projects(user.id)}


@app.get("/api/v1/projects/{project_id}")
def project_detail(project_id: str, user: User = Depends(current_user)) -> dict[str, Any]:
    return import_response(get_project(project_id, user))


@app.delete("/api/v1/projects/{project_id}")
def project_delete(project_id: str, user: User = Depends(current_user)) -> dict[str, bool]:
    project = get_project(project_id, user)
    PROJECTS.pop(project_id, None)
    if not delete_project(project_id, user.id):
        raise HTTPException(404, "project not found")
    return {"ok": True}


@app.get("/api/v1/projects/{project_id}/tree")
def tree(project_id: str, user: User = Depends(current_user)) -> dict[str, Any]:
    project = get_project(project_id, user)
    return {"project_id": project_id, "files": sorted(project["files"]), "tree": project["analysis"].tree, "excluded": project["analysis"].excluded}


@app.get("/api/v1/projects/{project_id}/files/{path:path}")
def read_file(project_id: str, path: str, user: User = Depends(current_user)) -> dict[str, Any]:
    project = get_project(project_id, user)
    clean = safe_path(path)
    if clean not in project["files"]:
        raise HTTPException(404, "file not found")
    return {"path": clean, "content": project["files"][clean]}


@app.get("/api/v1/projects/{project_id}/analysis")
def analysis(project_id: str, user: User = Depends(current_user)) -> dict[str, Any]:
    project = get_project(project_id, user)
    return project["analysis"].to_dict(include_content=False)


@app.post("/api/v1/projects/{project_id}/search")
def search(project_id: str, request: SearchRequest, user: User = Depends(current_user)) -> dict[str, Any]:
    started = time.perf_counter()
    project = get_project(project_id, user)
    results = search_index(project, request.query, request.path, language=request.language, kind=request.kind)
    end = request.offset + request.limit
    return {
        "query": request.query, "results": results[request.offset:end],
        "total_matches": len(results), "total_files": len({item["path"] for item in results}),
        "has_more": end < len(results), "elapsed_ms": round((time.perf_counter() - started) * 1000, 3),
    }


@app.post("/api/v1/projects/{project_id}/investigate")
def investigate(project_id: str, request: InvestigationRequest, user: User = Depends(current_user)) -> dict[str, Any]:
    project = get_project(project_id, user)
    report = run_investigation(project, request.question, request.error_message or request.query or "", request.stack_trace, request.file, request.symbol)
    report["findings"] = [{"type": "finding", **item} for item in report["confirmed_evidence"]]
    report["hypotheses"] = [{"type": "hypothesis", **item} for item in report["hypotheses"]]
    return report


def resolve_import(source_path: str, module: str, known_paths: set[str]) -> str | None:
    candidates: list[str] = []
    if module.startswith("."):
        base = Path(source_path).parent / module
        candidates.extend([base.as_posix(), f"{base.as_posix()}.py", f"{base.as_posix()}.js", f"{base.as_posix()}.ts", f"{base.as_posix()}/__init__.py"])
    elif "." in module or module.replace("_", "").isalnum():
        stem = module.replace(".", "/")
        parent = Path(source_path).parent
        candidates.extend([(parent / f"{stem}.py").as_posix(), (parent / f"{stem}.js").as_posix(), (parent / f"{stem}.ts").as_posix(), f"{stem}.py", f"{stem}.js", f"{stem}.ts", f"{stem}/__init__.py"])
    return next((candidate for candidate in candidates if candidate in known_paths), None)


@app.get("/api/v1/projects/{project_id}/graph")
def graph(project_id: str, scope: str | None = Query(default=None, max_length=500),
          depth: int | None = Query(default=None, ge=0, le=MAX_GRAPH_DEPTH),
          limit: int | None = Query(default=None, ge=1, le=MAX_GRAPH_LIMIT),
          user: User = Depends(current_user)) -> dict[str, Any]:
    project = get_project(project_id, user)
    return build_graph(project, resolve_import, scope=scope, depth=depth, limit=limit)


class ReportRequest(BaseModel):
    question: str = Field(default="", max_length=1000)
    error_message: str = Field(default="", max_length=2000)
    stack_trace: str = Field(default="", max_length=10000)
    file: str | None = Field(default=None, max_length=500)
    symbol: str | None = Field(default=None, max_length=200)


@app.post("/api/v1/projects/{project_id}/report")
def report(project_id: str, request: ReportRequest | None = None, user: User = Depends(current_user)) -> dict[str, str]:
    project = get_project(project_id, user)
    request = request or ReportRequest()
    investigation = run_investigation(project, request.question, request.error_message, request.stack_trace, request.file, request.symbol) if request.question or request.error_message or request.stack_trace or request.file or request.symbol else None
    lines = ["# RepoPilot Investigation Report", "", f"- Repository: {project['source'].get('repo') or project['source'].get('filename', 'uploaded-repository')}", f"- Files: {len(project['files'])}", f"- Symbols: {len(project['index']['symbols'])}", f"- Imports: {len(project['index']['imports'])}", "", "## Analysis boundaries", "", "- Deterministic static analysis only; repository code was not executed.", "- Unresolved imports are not treated as confirmed repository relationships."]
    if investigation:
        lines.extend(["", "## Question", "", request.question or "(not supplied)", "", "## Summary", "", investigation["summary"], "", "## Confirmed evidence"])
        lines.extend(f"- `{item['path']}:{item['line']}` — {item['text']}" for item in investigation["confirmed_evidence"])
        lines.extend(["", "## Hypotheses"])
        lines.extend(f"- **{item['confidence']}** — {item['text']}" for item in investigation["hypotheses"])
        lines.extend(["", "## Recommended next steps"])
        lines.extend(f"- {item}" for item in investigation["recommended_next_steps"])
        lines.extend(["", "## Limitations"])
        lines.extend(f"- {item}" for item in investigation["limitations"])
    lines.extend(["", "## Symbols"])
    lines.extend(f"- `{s['name']}` — `{s['path']}:{s['line']}`" for s in project["index"]["symbols"])
    return {"markdown": "\n".join(lines)}


app.include_router(workspace_router(current_user, get_project))


frontend_dist = Path(os.environ.get("FRONTEND_DIST_DIR", "/app/frontend-dist"))
if frontend_dist.is_dir():
    class SPAStaticFiles(StaticFiles):
        async def get_response(self, path: str, scope: dict[str, Any]):
            try:
                return await super().get_response(path, scope)
            except StarletteHTTPException as exc:
                if exc.status_code == 404 and scope.get("method") == "GET":
                    return await super().get_response("index.html", scope)
                raise

    app.mount("/", SPAStaticFiles(directory=frontend_dist, html=True), name="frontend")
