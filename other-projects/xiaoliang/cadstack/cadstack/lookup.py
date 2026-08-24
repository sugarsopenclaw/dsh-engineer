from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Mapping

from cadkernel.contracts import stable_json_dumps
from cadkernel.indexes import (
    SnapshotStore,
    query_endpoints,
    query_faces,
    query_region,
    search_text,
)
from cadsemantics.agentview import semantic_evidence_packet, similar_representations
from cadsemantics.storage import SemanticStore

from cadstack.layout import FactsLayout, validate_drawing_key
from cadstack.state import read_project_state


def _json_value(value: object) -> Any:
    return json.loads(stable_json_dumps(value))


def _drawing_paths(
    layout: FactsLayout,
    drawing_key: str,
) -> tuple[Mapping[str, Any], Path, Path | None]:
    state = read_project_state(layout)
    record = state["drawings"].get(validate_drawing_key(drawing_key))
    if not isinstance(record, Mapping):
        raise KeyError(f"unknown drawing key: {drawing_key}")
    stores = record.get("stores", {})
    if not isinstance(stores, Mapping) or not isinstance(stores.get("snapshot"), str):
        raise ValueError("drawing has no L1 snapshot")
    snapshot_path = layout.resolve_input_path(
        str(stores["snapshot"]), require_file=False
    )
    semantic_path = (
        layout.resolve_input_path(str(stores["semantic"]), require_file=False)
        if isinstance(stores.get("semantic"), str)
        else None
    )
    return record, snapshot_path, semantic_path


def lookup_drawing(
    *,
    project_root: str | Path,
    drawing_key: str,
    class_id: str | None = None,
    bounds: tuple[float, float, float, float] | None = None,
    representation: str | None = None,
    text: str | None = None,
    limit: int = 50,
) -> dict[str, Any]:
    if limit < 1 or limit > 500:
        raise ValueError("lookup limit must be in [1, 500]")
    if not any((class_id, bounds, representation, text)):
        raise ValueError("lookup requires class, bounds, representation, or text")
    layout = FactsLayout.from_project_root(project_root)
    _, snapshot_path, semantic_path = _drawing_paths(layout, drawing_key)
    snapshot = SnapshotStore.load(snapshot_path)
    result: dict[str, Any] = {
        "drawing_key": drawing_key,
        "snapshot_id": snapshot.snapshot_id,
        "semantic_matches": [],
        "text_matches": [],
    }
    if class_id is not None or bounds is not None:
        if semantic_path is None:
            result["semantic_status"] = "missing"
        else:
            matches = SemanticStore.query(
                semantic_path,
                class_id=class_id,
                bounds=bounds,
            )[:limit]
            result["semantic_matches"] = [_json_value(item) for item in matches]
    if representation is not None:
        if semantic_path is None:
            raise ValueError("representation lookup requires an L3 semantic store")
        bundle = SemanticStore.load(semantic_path)
        result["evidence_packet"] = _json_value(
            semantic_evidence_packet(bundle, representation)
        )
        result["similar"] = _json_value(
            similar_representations(bundle, representation)[:limit]
        )
    if text is not None:
        result["text_matches"] = _json_value(
            search_text(snapshot_path, snapshot, text, limit=limit)
        )
    result["facts_paths"] = {
        "l1": layout.relative(layout.l1_markdown(drawing_key)),
        "coverage": layout.relative(layout.coverage_json(drawing_key)),
        "semantic": layout.relative(layout.semantic_view_root(drawing_key) / "index.txt"),
    }
    return result


def probe_drawing(
    *,
    project_root: str | Path,
    drawing_key: str,
    bbox: tuple[float, float, float, float] | None = None,
    text: str | None = None,
    faces: tuple[float, float, float, float] | None = None,
    endpoint: tuple[float, float] | None = None,
    radius: float | None = None,
    limit: int = 50,
) -> dict[str, Any]:
    modes = sum(value is not None for value in (bbox, text, faces, endpoint))
    if modes != 1:
        raise ValueError("probe requires exactly one of bbox, text, faces, or endpoint")
    if limit < 1 or limit > 500:
        raise ValueError("probe limit must be in [1, 500]")
    layout = FactsLayout.from_project_root(project_root)
    _, snapshot_path, _ = _drawing_paths(layout, drawing_key)
    snapshot = SnapshotStore.load(snapshot_path)
    if bbox is not None:
        mode = "bbox"
        value = query_region(snapshot_path, snapshot, bbox, limit=limit)
    elif text is not None:
        mode = "text"
        value = search_text(snapshot_path, snapshot, text, limit=limit)
    elif faces is not None:
        mode = "faces"
        value = query_faces(snapshot_path, snapshot, faces, limit=limit)
    else:
        mode = "endpoint"
        value = query_endpoints(
            snapshot_path,
            snapshot,
            endpoint or (0.0, 0.0),
            radius=radius,
            limit=limit,
        )
    return {
        "drawing_key": drawing_key,
        "snapshot_id": snapshot.snapshot_id,
        "mode": mode,
        "evidence": _json_value(value),
        "facts_paths": {
            "l1": layout.relative(layout.l1_markdown(drawing_key)),
            "coverage": layout.relative(layout.coverage_json(drawing_key)),
        },
    }
