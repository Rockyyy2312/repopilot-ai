from __future__ import annotations

import io
import os
import re
import tarfile
import time
import uuid
import urllib.request
import zipfile
from typing import Any
from urllib.parse import urlsplit

from fastapi import FastAPI, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from app.analysis import AnalysisConfig, analyze_files
from app.analysis.engine import is_sensitive, safe_relative_path
from app.investigation import investigate as run_investigation

MAX_ARCHIVE_BYTES = 25 * 1024 * 1024
MAX_FILES = 5000
MAX_FILE_BYTES = 2 * 1024 * 1024
MAX_EXTRACTED_BYTES = 50 * 1024 * 1024
MAX_ARCHIVE_MEMBERS = MAX_FILES * 2
MAX_SEARCH_RESULTS = 100
GITHUB_DOWNLOAD_TIMEOUT = 15
PROJECT_RETENTION_SECONDS = 60 * 60
MAX_PROJECTS = 20
ANALYSIS_CONFIG = AnalysisConfig(
    max_files=int(os.environ.get("REPOPILOT_MAX_FILES", MAX_FILES)),
    max_file_bytes=int(os.environ.get("REPOPILOT_MAX_FILE_BYTES", MAX_FILE_BYTES)),
)

app = FastAPI(title="RepoPilot AI", version="0.1.0")
PROJECTS: dict[str, dict[str, Any]] = {}


class GithubImport(BaseModel):
    url: str


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


def create_project(files: dict[str, str], source: dict[str, Any]) -> dict[str, Any]:
    cleanup_projects()
    project_id = uuid.uuid4().hex
    result = analyze_files(files, ANALYSIS_CONFIG)
    project = {
        "id": project_id,
        "files": {item.path: item.content for item in result.files},
        "analysis": result,
        "index": {"symbols": [symbol_to_dict(item) for item in result.symbols], "imports": [import_to_dict(item) for item in result.imports]},
        "source": source,
        "created_at": time.time(),
        "accessed_at": time.time(),
    }
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


def get_project(project_id: str) -> dict[str, Any]:
    cleanup_projects()
    project = PROJECTS.get(project_id)
    if not project:
        raise HTTPException(404, "project not found")
    project["accessed_at"] = time.time()
    return project


@app.get("/api/v1/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/v1/projects/import/github")
def import_github(payload: GithubImport) -> dict[str, Any]:
    owner, repo = validate_github_url(payload.url)
    data = fetch_github_archive(owner, repo)
    files = extract_archive(data, f"{repo}.zip")
    project = create_project(files, {"type": "github", "url": payload.url, "owner": owner, "repo": repo})
    return import_response(project)


@app.post("/api/v1/projects/import/archive")
async def import_archive(file: UploadFile = File(...)) -> dict[str, Any]:
    data = await file.read(MAX_ARCHIVE_BYTES + 1)
    project = create_project(extract_archive(data, file.filename or ""), {"type": "archive", "filename": file.filename})
    return import_response(project)


@app.get("/api/v1/projects/{project_id}/tree")
def tree(project_id: str) -> dict[str, Any]:
    project = get_project(project_id)
    return {"project_id": project_id, "files": sorted(project["files"]), "tree": project["analysis"].tree, "excluded": project["analysis"].excluded}


@app.get("/api/v1/projects/{project_id}/files/{path:path}")
def read_file(project_id: str, path: str) -> dict[str, Any]:
    project = get_project(project_id)
    clean = safe_path(path)
    if clean not in project["files"]:
        raise HTTPException(404, "file not found")
    return {"path": clean, "content": project["files"][clean]}


@app.get("/api/v1/projects/{project_id}/analysis")
def analysis(project_id: str) -> dict[str, Any]:
    project = get_project(project_id)
    return project["analysis"].to_dict(include_content=False)


@app.post("/api/v1/projects/{project_id}/search")
def search(project_id: str, request: SearchRequest) -> dict[str, Any]:
    project = get_project(project_id)
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
def investigate(project_id: str, request: InvestigationRequest) -> dict[str, Any]:
    project = get_project(project_id)
    report = run_investigation(project, request.question, request.error_message or request.query or "", request.stack_trace, request.file, request.symbol)
    report["findings"] = [{"type": "finding", **item} for item in report["confirmed_evidence"]]
    report["hypotheses"] = [{"type": "hypothesis", **item} for item in report["hypotheses"]]
    return report


@app.get("/api/v1/projects/{project_id}/graph")
def graph(project_id: str) -> dict[str, Any]:
    project = get_project(project_id)
    nodes = [{"id": path, "type": "file"} for path in sorted(project["files"])]
    edges = [{"from": item["path"], "to": item["module"], "evidence": {"line": int(item["line"]), "kind": "import"}} for item in project["index"]["imports"]]
    return {"nodes": nodes, "edges": edges}


@app.get("/api/v1/projects/{project_id}/report")
def report(project_id: str) -> dict[str, str]:
    project = get_project(project_id)
    lines = [f"# RepoPilot report", "", f"- Files: {len(project['files'])}", f"- Symbols: {len(project['index']['symbols'])}", f"- Imports: {len(project['index']['imports'])}", "", "## Symbols"]
    lines.extend(f"- `{s['name']}` — `{s['path']}:{s['line']}`" for s in project["index"]["symbols"])
    return {"markdown": "\n".join(lines)}
