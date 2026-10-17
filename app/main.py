from __future__ import annotations

import io
import re
import tarfile
import uuid
import zipfile
from pathlib import PurePosixPath
from typing import Any

from fastapi import FastAPI, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

MAX_ARCHIVE_BYTES = 25 * 1024 * 1024
MAX_FILES = 5000
MAX_FILE_BYTES = 2 * 1024 * 1024
MAX_SEARCH_RESULTS = 100

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


def safe_path(path: str) -> str:
    path = path.replace("\\", "/").strip("/")
    p = PurePosixPath(path)
    if not path or p.is_absolute() or any(part in ("", ".", "..") for part in p.parts):
        raise HTTPException(400, "invalid path")
    return "/".join(p.parts)


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
                files[clean] = content.decode("utf-8", errors="replace")
        source.close()
    except (zipfile.BadZipFile, tarfile.TarError, OSError) as exc:
        raise HTTPException(400, "invalid archive") from exc
    return files


def index_files(files: dict[str, str]) -> dict[str, Any]:
    symbols: list[dict[str, str]] = []
    imports: list[dict[str, str]] = []
    for path in sorted(files):
        text = files[path]
        for line_no, line in enumerate(text.splitlines(), 1):
            match = re.match(r"^\s*(?:def|class|function|interface|type|const)\s+([A-Za-z_$][\w$]*)", line)
            if match:
                symbols.append({"name": match.group(1), "path": path, "line": str(line_no)})
            match = re.match(r"^\s*(?:import\s+(.+?)\s+from|import\s+['\"](.+?)['\"]|import\s+([A-Za-z0-9_./-]+)|from\s+(.+?)\s+import|require\(['\"](.+?)['\"]\))", line)
            if match:
                imports.append({"module": next(x for x in match.groups() if x), "path": path, "line": str(line_no)})
    return {"symbols": symbols, "imports": imports}


def create_project(files: dict[str, str], source: dict[str, Any]) -> dict[str, Any]:
    project_id = uuid.uuid4().hex
    project = {"id": project_id, "files": files, "index": index_files(files), "source": source}
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
    return create_project({}, {"type": "github", "url": payload.url, "owner": owner, "repo": repo}) | {"files": []}


@app.post("/api/v1/projects/import/archive")
async def import_archive(file: UploadFile = File(...)) -> dict[str, Any]:
    data = await file.read(MAX_ARCHIVE_BYTES + 1)
    project = create_project(extract_archive(data, file.filename or ""), {"type": "archive", "filename": file.filename})
    return {"id": project["id"], "source": project["source"], "file_count": len(project["files"]), "index": project["index"]}


@app.get("/api/v1/projects/{project_id}/tree")
def tree(project_id: str) -> dict[str, Any]:
    project = get_project(project_id)
    return {"project_id": project_id, "files": sorted(project["files"])}


@app.get("/api/v1/projects/{project_id}/files/{path:path}")
def read_file(project_id: str, path: str) -> dict[str, Any]:
    project = get_project(project_id)
    clean = safe_path(path)
    if clean not in project["files"]:
        raise HTTPException(404, "file not found")
    return {"path": clean, "content": project["files"][clean]}


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
                results.append({"path": path, "line": line_no, "text": line[:1000]})
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
