from __future__ import annotations

import io
import hmac
import secrets
import os
import threading
import re
import tarfile
import time
import uuid
import urllib.request
import zipfile
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from fastapi import Cookie, Depends, FastAPI, File, HTTPException, Request, Response, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.analysis import AnalysisConfig, analyze_files
from app.analysis.engine import is_sensitive, safe_relative_path
from app.investigation import investigate as run_investigation
from app.project_store import delete_expired, delete_project, list_projects as stored_projects, load_project, save_project, touch_project
from app.auth import APP_ENV, CSRF_COOKIE, SECURE_COOKIES, SESSION_COOKIE, SESSION_TTL, User, authenticate, create_session, create_user, delete_session, get_user

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


class GithubImport(BaseModel):
    url: str


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


class SearchRequest(BaseModel):
    query: str = Field(min_length=0, max_length=200)
    path: str | None = None
    limit: int = Field(default=50, ge=1, le=MAX_SEARCH_RESULTS)


class InvestigationRequest(BaseModel):
    question: str = Field(min_length=1, max_length=1000)
    error_message: str = Field(default="", max_length=2000)
    stack_trace: str = Field(default="", max_length=10000)
    file: str | None = Field(default=None, max_length=500)
    symbol: str | None = Field(default=None, max_length=200)
    query: str | None = Field(default=None, max_length=200)


def fetch_github_archive(owner: str, repo: str) -> bytes:
    archive_url = f"https://codeload.github.com/{owner}/{repo}/zip/refs/heads/HEAD"
    request = urllib.request.Request(archive_url, headers={"User-Agent": "RepoPilot-AI/0.1"})
    try:
        opener = urllib.request.build_opener(_NoRedirectHandler())
        with opener.open(request, timeout=GITHUB_DOWNLOAD_TIMEOUT) as response:
            content_length = response.headers.get("Content-Length")
            if content_length and int(content_length) > MAX_ARCHIVE_BYTES:
                raise HTTPException(413, "repository archive exceeds size limit")
            data = response.read(MAX_ARCHIVE_BYTES + 1)
    except HTTPException:
        raise
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



def reserve_import(user_id: str) -> None:
    now = time.time()
    with IMPORT_STATE_LOCK:
        timestamps = [item for item in IMPORT_TIMES.get(user_id, []) if now - item < 60]
        if len(timestamps) >= MAX_IMPORTS_PER_MINUTE:
            raise HTTPException(429, "import rate limit reached; try again later")
        if IMPORT_IN_FLIGHT.get(user_id, 0) >= MAX_IMPORTS_IN_FLIGHT_PER_USER:
            raise HTTPException(429, "another import is already being processed")
        if sum(1 for item in PROJECTS.values() if item.get("user_id") == user_id) >= MAX_PROJECTS_PER_USER:
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
    owned_projects = [item for item in PROJECTS.values() if item.get("user_id") == user_id]
    if len(owned_projects) >= MAX_PROJECTS_PER_USER:
        raise HTTPException(429, "project quota reached; remove an existing project before importing another")
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
        "repository_name": project["source"]["repo"] if project["source"]["type"] == "github" else project["source"].get("filename", "uploaded-repository"),
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
            result = analyze_files(stored["files"], ANALYSIS_CONFIG)
            stored["analysis"] = result
            stored["index"] = {"symbols": [symbol_to_dict(item) for item in result.symbols], "imports": [import_to_dict(item) for item in result.imports]}
            PROJECTS[project_id] = stored
            project = stored
    if not project:
        raise HTTPException(404, "project not found")
    if project.get("user_id") != user.id:
        raise HTTPException(404, "project not found")
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
def auth_register(payload: AuthRequest, response: Response) -> dict[str, Any]:
    email = payload.email
    try:
        user = create_user(email, payload.password)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    set_auth_cookies(response, user.id)
    return {"user": user_response(user)}


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
    items = []
    for item in stored_projects(user.id):
        project = get_project(item["id"], user)
        items.append(import_response(project))
    return {"projects": items}


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
    project = get_project(project_id, user)
    needle = request.query.casefold()
    if not needle:
        return {"query": request.query, "results": []}
    results = search_index(project, needle, request.path, request.limit)
    return {"query": request.query, "results": results}


def search_index(project: dict[str, Any], needle: str, requested_path: str | None, limit: int) -> list[dict[str, Any]]:
    path_prefix = safe_path(requested_path) if requested_path else None
    files_by_path = {item.path: item for item in project["analysis"].files}
    candidates: dict[tuple[str, int], dict[str, Any]] = {}

    def add(path: str, line: int, kind: str, score: int, text: str) -> None:
        if path_prefix and not (path == path_prefix or path.startswith(path_prefix + "/")):
            return
        key = (path, line)
        current = candidates.get(key)
        result = {"path": path, "line": line, "text": text[:1000], "kind": kind, "language": files_by_path[path].language}
        if current is None or score > current["_score"]:
            result["_score"] = score
            candidates[key] = result

    for path, file in files_by_path.items():
        path_lower = path.casefold()
        if needle in path_lower:
            exact_path = needle == path_lower or needle == path.rsplit("/", 1)[-1].casefold()
            add(path, 1, "path", 80 if exact_path else 70, path)
        lines = file.content.splitlines()
        for line_number, line in enumerate(lines, 1):
            if needle in line.casefold():
                add(path, line_number, "content", 50, line)

    for symbol in project["analysis"].symbols:
        if symbol.name.casefold() == needle:
            text = files_by_path[symbol.location.path].content.splitlines()[symbol.location.line - 1]
            add(symbol.location.path, symbol.location.line, "symbol", 100, text)

    for relation in project["analysis"].imports:
        if relation.module.casefold() == needle:
            text = files_by_path[relation.location.path].content.splitlines()[relation.location.line - 1]
            add(relation.location.path, relation.location.line, "import", 90, text)

    ranked = sorted(candidates.values(), key=lambda item: (-item["_score"], item["path"], item["line"]))
    for result in ranked:
        result.pop("_score", None)
    return ranked[:limit]


@app.post("/api/v1/projects/{project_id}/investigate")
def investigate(project_id: str, request: InvestigationRequest, user: User = Depends(current_user)) -> dict[str, Any]:
    project = get_project(project_id, user)
    report = run_investigation(project, request.question, request.error_message or request.query or "", request.stack_trace, request.file, request.symbol)
    report["findings"] = [{"type": "finding", **item} for item in report["confirmed_evidence"]]
    report["hypotheses"] = [{"type": "hypothesis", **item} for item in report["hypotheses"]]
    return report


@app.get("/api/v1/projects/{project_id}/graph")
def graph(project_id: str, user: User = Depends(current_user)) -> dict[str, Any]:
    project = get_project(project_id, user)
    nodes = [{"id": path, "type": "file"} for path in sorted(project["files"])]
    edges = [{"from": item["path"], "to": item["module"], "evidence": {"line": int(item["line"]), "kind": "import"}} for item in project["index"]["imports"]]
    return {"nodes": nodes, "edges": edges}


@app.get("/api/v1/projects/{project_id}/report")
def report(project_id: str, user: User = Depends(current_user)) -> dict[str, str]:
    project = get_project(project_id, user)
    lines = [f"# RepoPilot report", "", f"- Files: {len(project['files'])}", f"- Symbols: {len(project['index']['symbols'])}", f"- Imports: {len(project['index']['imports'])}", "", "## Symbols"]
    lines.extend(f"- `{s['name']}` — `{s['path']}:{s['line']}`" for s in project["index"]["symbols"])
    return {"markdown": "\n".join(lines)}


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
