from __future__ import annotations

from collections import deque
from typing import Any, Callable


def build_graph(project: dict[str, Any], resolve_import: Callable[[str, str, set[str]], str | None],
                scope: str | None = None, depth: int | None = None, limit: int | None = None) -> dict[str, Any]:
    """Build a bounded import graph without changing the unbounded response fields.

    ``scope`` is a file or directory prefix, ``depth`` is directed import hops, and
    ``limit`` bounds returned nodes. Limits are applied to the raw graph before the
    response dictionaries are constructed. External nodes are retained only when
    their importing edge survives the bound.
    """
    known_paths = set(project["files"])
    raw_nodes = [{"id": path, "type": "file"} for path in sorted(known_paths)]
    raw_edges: list[dict[str, Any]] = []
    for item in project["index"]["imports"]:
        resolved = resolve_import(item["path"], item["module"], known_paths)
        target = resolved or item["module"]
        raw_edges.append({"from": item["path"], "to": target, "evidence": {
            "line": int(item["line"]), "kind": "import", "resolved": bool(resolved), "module": item["module"]
        }})

    selected = {item["id"] for item in raw_nodes}
    if scope:
        clean_scope = scope.strip().strip("/")
        if clean_scope == ".":
            # The UI uses "." as the explicit root-directory scope.  An empty
            # scope means "all", so root-level files need their own sentinel.
            selected = {path for path in selected if "/" not in path}
        else:
            selected = {path for path in selected if path == clean_scope or path.startswith(clean_scope + "/")}
    if depth is not None:
        distances = {path: 0 for path in selected}
        queue = deque(selected)
        while queue:
            source = queue.popleft()
            if distances[source] >= depth:
                continue
            for edge in raw_edges:
                if edge["from"] == source and edge["to"] in known_paths and edge["to"] not in distances:
                    distances[edge["to"]] = distances[source] + 1
                    queue.append(edge["to"])
        selected = set(distances)

    filtered_edges = [edge for edge in raw_edges if edge["from"] in selected and (edge["to"] in selected or not edge["evidence"]["resolved"])]
    # Include external targets only for surviving edges, then apply the node bound.
    external = {edge["to"] for edge in filtered_edges if not edge["evidence"]["resolved"]}
    ordered_ids = sorted(selected) + sorted(external)
    total_nodes = len(ordered_ids)
    total_edges = len(filtered_edges)
    node_truncated = False
    edge_truncated = False
    if limit is not None and len(ordered_ids) > limit:
        allowed = set(ordered_ids[:limit])
        selected = selected & allowed
        filtered_edges = [edge for edge in filtered_edges if edge["from"] in allowed and edge["to"] in allowed]
        ordered_ids = ordered_ids[:limit]
        node_truncated = True
    if limit is not None and len(filtered_edges) > limit:
        filtered_edges = filtered_edges[:limit]
        edge_truncated = True
    nodes = [{"id": node_id, "type": "file" if node_id in known_paths else "external"} for node_id in ordered_ids]
    edges = filtered_edges
    limitations = ["Unresolved imports are labeled external and are not proof of a repository file relationship."] if any(not edge["evidence"]["resolved"] for edge in raw_edges) else []
    result: dict[str, Any] = {"nodes": nodes, "edges": edges, "limitations": limitations}
    if scope is not None or depth is not None or limit is not None:
        result["truncated"] = {
            "nodes": node_truncated or len(ordered_ids) < total_nodes,
            "edges": edge_truncated or len(edges) < total_edges,
            "total_nodes": total_nodes,
            "total_edges": total_edges,
            "scope": scope,
            "depth": depth,
            "limit": limit,
        }
    return result
