from __future__ import annotations

import json
from pathlib import Path
import shutil
import tempfile
from typing import Any, Mapping

from cadkernel.indexes import SnapshotStore
from cadpatterns.runtime import PatternRuntime
from cadpatterns.storage import PatternStore
from cadsemantics.agentview import export_text_tree
from cadsemantics.runtime import SemanticRuntime
from cadsemantics.storage import SemanticStore

from cadstack.layout import FactsLayout, validate_drawing_key
from cadstack.state import (
    read_project_state,
    record_failure,
    replace_generated_tree,
    save_project_state,
    state_lock,
    utc_now,
)


def _record_path(layout: FactsLayout, record: Mapping[str, Any], name: str) -> Path:
    stores = record.get("stores", {})
    if not isinstance(stores, Mapping) or not isinstance(stores.get(name), str):
        raise ValueError(f"drawing has no {name} store")
    return layout.resolve_input_path(str(stores[name]), require_file=False)


def build_drawing(
    *,
    project_root: str | Path,
    drawing_key: str,
) -> dict[str, Any]:
    layout = FactsLayout.from_project_root(project_root)
    layout.ensure()
    key = validate_drawing_key(drawing_key)
    state = read_project_state(layout)
    raw_record = state["drawings"].get(key)
    if not isinstance(raw_record, Mapping):
        raise KeyError(f"drawing has not been ingested: {key}")
    snapshot_path = _record_path(layout, raw_record, "snapshot")
    snapshot_errors = SnapshotStore.verify(snapshot_path)
    if snapshot_errors:
        error = ValueError("Snapshot integrity failure: " + ", ".join(snapshot_errors))
        record_failure(
            layout,
            key,
            "l1",
            error,
            expected_snapshot_id=str(raw_record.get("snapshot_id", "")),
        )
        raise error

    try:
        pattern_result = PatternRuntime().build_and_store(snapshot_path, layout.store_root)
        if pattern_result.location is None:
            raise RuntimeError("PatternRuntime did not persist its graph")
        pattern_path = Path(pattern_result.location.path)
        pattern_errors = PatternStore.verify(pattern_path, snapshot_path=snapshot_path)
        if pattern_errors:
            raise ValueError("PatternStore integrity failure: " + ", ".join(pattern_errors))
        with state_lock(layout):
            current = read_project_state(layout)
            record = current["drawings"].get(key)
            if not isinstance(record, dict):
                raise RuntimeError("drawing state disappeared while L2 was building")
            if record.get("snapshot_id") != pattern_result.graph.snapshot_id:
                raise RuntimeError("drawing was re-ingested while its old L2 was building")
            stores = dict(record.get("stores", {}))
            stores["pattern"] = layout.relative(pattern_path)
            stores.pop("semantic", None)
            layers = dict(record.get("layers", {}))
            layers.update({"l1": "ready", "l2": "ready", "l3": "missing", "l4": "missing"})
            record.update(
                {
                    "stores": stores,
                    "layers": layers,
                    "pattern_graph_id": pattern_result.graph.pattern_graph_id,
                    "updated_at": utc_now(),
                }
            )
            record.pop("drawing_semantic_graph_id", None)
            record.pop("project_semantic_graph_id", None)
            record.pop("semantic_coverage", None)
            record.pop("last_error", None)
            save_project_state(layout, current)
    except Exception as error:
        record_failure(
            layout,
            key,
            "l2",
            error,
            expected_snapshot_id=str(raw_record.get("snapshot_id", "")),
        )
        raise

    try:
        project_id = str(state["project_id"])
        semantic_result = SemanticRuntime().build_and_store(
            snapshot_path,
            pattern_path,
            layout.store_root,
            project_id=project_id,
        )
        if semantic_result.location is None:
            raise RuntimeError("SemanticRuntime did not persist its graph")
        semantic_path = Path(str(semantic_result.location.path))
        semantic_errors = SemanticStore.verify(
            semantic_path,
            snapshot_path=snapshot_path,
            pattern_path=pattern_path,
        )
        if semantic_errors:
            raise ValueError("SemanticStore integrity failure: " + ", ".join(semantic_errors))

        semantic_target = layout.semantic_view_root(key)
        semantic_target.parent.mkdir(parents=True, exist_ok=True)
        staging = Path(
            tempfile.mkdtemp(prefix=f".{key}.semantic-", dir=semantic_target.parent)
        )
        try:
            export_text_tree(semantic_result.bundle, staging)
            replace_generated_tree(staging, semantic_target)
        finally:
            if staging.exists():
                shutil.rmtree(staging, ignore_errors=True)

        semantic_coverage = json.loads(
            json.dumps(
                {
                    "pattern_resolution_coverage": (
                        semantic_result.coverage.pattern_resolution_coverage
                    ),
                    "evidence_coverage": semantic_result.coverage.evidence_coverage,
                    "domain_leakage_rate": semantic_result.coverage.domain_leakage_rate,
                    "unexplained_pattern_count": len(
                        semantic_result.coverage.unexplained_pattern_keys
                    ),
                }
            )
        )
        with state_lock(layout):
            current = read_project_state(layout)
            record = current["drawings"].get(key)
            if not isinstance(record, dict):
                raise RuntimeError("drawing state disappeared while L3 was building")
            if record.get("snapshot_id") != pattern_result.graph.snapshot_id:
                raise RuntimeError("drawing was re-ingested while its old L3 was building")
            stores = dict(record.get("stores", {}))
            stores.update(
                {
                    "pattern": layout.relative(pattern_path),
                    "semantic": layout.relative(semantic_path),
                }
            )
            layers = dict(record.get("layers", {}))
            layers.update({"l1": "ready", "l2": "ready", "l3": "ready", "l4": "missing"})
            record.update(
                {
                    "stores": stores,
                    "layers": layers,
                    "pattern_graph_id": pattern_result.graph.pattern_graph_id,
                    "drawing_semantic_graph_id": (
                        semantic_result.drawing_graph.drawing_semantic_graph_id
                    ),
                    "project_semantic_graph_id": (
                        semantic_result.project_graph.project_semantic_graph_id
                    ),
                    "semantic_coverage": semantic_coverage,
                    "updated_at": utc_now(),
                }
            )
            record.pop("last_error", None)
            save_project_state(layout, current)
    except Exception as error:
        record_failure(
            layout,
            key,
            "l3",
            error,
            expected_snapshot_id=str(raw_record.get("snapshot_id", "")),
        )
        raise
    return {
        "drawing_key": key,
        "snapshot_id": pattern_result.graph.snapshot_id,
        "pattern_graph_id": pattern_result.graph.pattern_graph_id,
        "drawing_semantic_graph_id": semantic_result.drawing_graph.drawing_semantic_graph_id,
        "layers": {"l1": "ready", "l2": "ready", "l3": "ready", "l4": "missing"},
        "semantic_coverage": semantic_coverage,
        "facts_paths": {
            "semantic": layout.relative(semantic_target),
            "semantic_index": layout.relative(semantic_target / "index.txt"),
        },
    }
