from __future__ import annotations

import io
import os
import re
import tarfile
import uuid
import urllib.request
import zipfile
from typing import Any

from fastapi import FastAPI, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from app.analysis import AnalysisConfig, analyze_files
from app.analysis.engine import is_sensitive, safe_relative_path

MAX_ARCHIVE_BYTES = 25 * 1024 * 1024
MAX_FILES = 5000
MAX_FILE_BYTES = 2 * 1024 * 1024
MAX_SEARCH_RESULTS = 100
ANALYSIS_CONFIG = AnalysisConfig(
    max_files=int(os.environ.get("REPOPILOT_MAX_FILES", MAX_FILES)),
    max_file_bytes=int(os.environ.get("REPOPILOT_MAX_FILE_BYTES", MAX_FILE_BYTES)),
)

app = FastAPI(title="RepoPilot AI", version="0.1.0")
PROJECTS: dict[str, dict[str, Any]] = {}


class GithubImport(BaseModel):
    url: str


class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=200)
    path: str | None = None
    limit: int = Field(default=50, ge=1, le=MAX_SEARCH_RESULTS)


class InvestigationRequest(BaseModel):
    question: str = Field(min_length=1, max_length=1000)
    query: str | None = Field(default=None, max_length=200)


def fetch_github_archive(owner: str, repo: str) -> bytes:
    archive_url = f"https://codeload.github.com/{owner}/{repo}/zip/refs/heads/HEAD"
    request = urllib.request.Request(archive_url, headers={"User-Agent": "RepoPilot-AI/0.1"})
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            data = response.read(MAX_ARCHIVE_BYTES + 1)
    except Exception as exc:
        raise HTTPException(502, "unable to fetch the public GitHub repository") from exc
    if len(data) > MAX_ARCHIVE_BYTES:
        raise HTTPException(413, "repository archive exceeds size limit")
    return data


def safe_path(path: str) -> str:
    try:
        return safe_relative_path(path)
    except ValueError as exc:
        raise HTTPException(400, "invalid path") from exc


def validate_github_url(url: str) -> tuple[str, str]:
    m = re.fullmatch(r"https://github\.com/([A-Za-z0-9_.-]{1,100})/([A-Za-z0-9_.-]{1,100})(?:\.git)?/?", url)
    if not m:
        raise HTTPException(400, "url must be an https GitHub repository URL")
    return m.group(1), m.group(2).removesuffix(".git")


def extract_archive(data: bytes, filename: str) -> dict[str, str]:
    if len(data) > MAX_ARCHIVE_BYTES:
        raise HTTPException(413, "archive exceeds size limit")
    files: dict[str, str] = {}
    try:
        if filename.lower().endswith(".zip"):
            source = zipfile.ZipFile(io.BytesIO(data))
            members = [(i.filename, not i.is_dir(), lambda i=i: source.open(i)) for i in source.infolist()]
        elif filename.lower().endswith((".tar.gz", ".tgz", ".tar")):
            source = tarfile.open(fileobj=io.BytesIO(data), mode="r:*")
            members = [(i.name, i.isfile(), lambda i=i: source.extractfile(i)) for i in source.getmembers()]
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
            try:
                files[clean] = content.decode("utf-8")
            except UnicodeDecodeError:
                continue
        source.close()
    except (zipfile.BadZipFile, tarfile.TarError, OSError) as exc:
        raise HTTPException(400, "invalid archive") from exc
    return files


def index_files(files: dict[str, str]) -> dict[str, Any]:
    result = analyze_files(files, ANALYSIS_CONFIG)
    return {
        "symbols": [symbol_to_dict(item) for item in result.symbols],
        "imports": [import_to_dict(item) for item in result.imports],
    }


def symbol_to_dict(symbol: Any) -> dict[str, Any]:
    return {"name": symbol.name, "kind": symbol.kind, "path": symbol.location.path, "line": symbol.location.line}


def import_to_dict(relation: Any) -> dict[str, Any]:
    return {"module": relation.module, "path": relation.location.path, "line": relation.location.line}


def create_project(files: dict[str, str], source: dict[str, Any]) -> dict[str, Any]:
    project_id = uuid.uuid4().hex
    result = analyze_files(files, ANALYSIS_CONFIG)
    project = {
        "id": project_id,
        "files": {item.path: item.content for item in result.files},
        "analysis": result,
        "index": {"symbols": [symbol_to_dict(item) for item in result.symbols], "imports": [import_to_dict(item) for item in result.imports]},
        "source": source,
    }
    PROJECTS[project_id] = project
    return project


def get_project(project_id: str) -> dict[str, Any]:
    project = PROJECTS.get(project_id)
    if not project:
        raise HTTPException(404, "project not found")
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
    return {"id": project["id"], "source": project["source"], "file_count": len(files), "analysis": project["analysis"].to_dict(include_content=False), "index": project["index"]}


@app.post("/api/v1/projects/import/archive")
async def import_archive(file: UploadFile = File(...)) -> dict[str, Any]:
    data = await file.read(MAX_ARCHIVE_BYTES + 1)
    project = create_project(extract_archive(data, file.filename or ""), {"type": "archive", "filename": file.filename})
    return {"id": project["id"], "source": project["source"], "file_count": len(project["files"]), "analysis": project["analysis"].to_dict(include_content=False), "index": project["index"]}


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
    results = []
    for path in sorted(project["files"]):
        if request.path and not path.startswith(safe_path(request.path)):
            continue
        for line_no, line in enumerate(project["files"][path].splitlines(), 1):
            if needle in line.casefold():
                results.append({"path": path, "line": line_no, "text": line[:1000], "kind": "content"})
                if len(results) >= request.limit:
                    return {"query": request.query, "results": results}
    return {"query": request.query, "results": results}


@app.post("/api/v1/projects/{project_id}/investigate")
def investigate(project_id: str, request: InvestigationRequest) -> dict[str, Any]:
    project = get_project(project_id)
    query = request.query or request.question
    result = search(project_id, SearchRequest(query=query, limit=20))
    findings = [{"type": "finding", **item} for item in result["results"]]
    hypotheses = [] if findings else [{"type": "hypothesis", "text": "No matching evidence was found; inspect callers and runtime configuration."}]
    return {"question": request.question, "findings": findings, "hypotheses": hypotheses}


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
