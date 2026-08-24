from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Mapping

from cadkernel.indexes import SnapshotStore
from cadpatterns.storage import PatternStore
from cadsemantics.storage import SemanticStore
from cadtasks.binding import ProjectBinding

from cadstack.bind import binding_integrity_errors
from cadstack.layout import FactsLayout, validate_drawing_key
from cadstack.state import read_project_state


# Each facts_paths key mirrors one build layer's view: l1/coverage are the L1
# outputs (layout.l1_markdown/coverage_json), semantic is the L3 export
# (layout.semantic_view_root). Ingest records planned paths before the layers
# exist, so a key is reported only while its layer verifies ready.
_FACTS_PATH_LAYER = {
    "l1": "l1",
    "coverage": "l1",
    "semantic": "l3",
}


def _ready_facts_paths(
    paths: Mapping[str, Any],
    layers: Mapping[str, str],
) -> dict[str, Any]:
    visible: dict[str, Any] = {}
    for name, value in paths.items():
        layer = _FACTS_PATH_LAYER.get(str(name))
        if layer is not None and layers.get(layer) != "ready":
            continue
        visible[name] = value
    return visible


def _directory(
    layout: FactsLayout,
    record: Mapping[str, Any],
    name: str,
) -> Path | None:
    stores = record.get("stores", {})
    if not isinstance(stores, Mapping) or not isinstance(stores.get(name), str):
        return None
    try:
        return layout.resolve_input_path(str(stores[name]), require_file=False)
    except (OSError, ValueError):
        return None


def _verified_layers(
    layout: FactsLayout,
    key: str,
    record: Mapping[str, Any],
    binding: ProjectBinding | None,
) -> tuple[dict[str, str], list[str]]:
    errors: list[str] = []
    snapshot = _directory(layout, record, "snapshot")
    pattern = _directory(layout, record, "pattern")
    semantic = _directory(layout, record, "semantic")
    l1_ready = layout.l1_markdown(key).is_file() and layout.coverage_json(key).is_file()
    if snapshot is not None:
        try:
            snapshot_errors = SnapshotStore.verify(snapshot)
            errors.extend(f"snapshot:{item}" for item in snapshot_errors)
            l1_ready = l1_ready and not snapshot_errors
        except (OSError, TypeError, ValueError) as error:
            errors.append(f"snapshot:{error}")
            l1_ready = False
    else:
        l1_ready = False
    l2_ready = False
    if l1_ready and pattern is not None and snapshot is not None:
        try:
            pattern_errors = PatternStore.verify(pattern, snapshot_path=snapshot)
            errors.extend(f"pattern:{item}" for item in pattern_errors)
            l2_ready = not pattern_errors
        except (OSError, TypeError, ValueError) as error:
            errors.append(f"pattern:{error}")
    l3_ready = False
    if l2_ready and semantic is not None and snapshot is not None and pattern is not None:
        try:
            semantic_errors = SemanticStore.verify(
                semantic,
                snapshot_path=snapshot,
                pattern_path=pattern,
            )
            errors.extend(f"semantic:{item}" for item in semantic_errors)
            l3_ready = not semantic_errors and layout.semantic_view_root(key).joinpath(
                "index.txt"
            ).is_file()
        except (OSError, TypeError, ValueError) as error:
            errors.append(f"semantic:{error}")
    l4_ready = False
    if l3_ready and binding is not None and semantic is not None:
        semantic_resolved = semantic.resolve()
        l4_ready = any(
            Path(source.semantic_path).resolve() == semantic_resolved
            for source in binding.sources
        )
    stored_layers = record.get("layers", {})
    stored_layers = stored_layers if isinstance(stored_layers, Mapping) else {}

    def label(ready: bool, name: str) -> str:
        if ready:
            return "ready"
        return "failed" if stored_layers.get(name) == "failed" else "missing"

    return (
        {
            "l1": label(l1_ready, "l1"),
            "l2": label(l2_ready, "l2"),
            "l3": label(l3_ready, "l3"),
            "l4": label(l4_ready, "l4"),
        },
        errors,
    )


def project_status(
    *,
    project_root: str | Path,
    drawing_key: str | None = None,
) -> dict[str, Any]:
    layout = FactsLayout.from_project_root(project_root)
    state = read_project_state(layout)
    binding: ProjectBinding | None = None
    binding_errors: list[str] = []
    if layout.binding_json.is_file():
        try:
            candidate = ProjectBinding.load(layout.binding_json)
            verified = binding_integrity_errors(
                layout,
                candidate,
                expected_project_id=str(state["project_id"]),
            )
            binding_errors.extend(verified)
            if not verified:
                binding = candidate
        except (OSError, TypeError, ValueError) as error:
            binding_errors.append(str(error))
    selected_key = None if drawing_key is None else validate_drawing_key(drawing_key)
    drawings: list[dict[str, Any]] = []
    for key in sorted(state["drawings"]):
        if selected_key is not None and key != selected_key:
            continue
        record = state["drawings"][key]
        if not isinstance(record, Mapping):
            continue
        layers, integrity_errors = _verified_layers(layout, key, record, binding)
        coverage = record.get("coverage", {})
        conformance = record.get("conformance")
        gaps = record.get("capability_gaps", [])
        paths = record.get("facts_paths", {})
        drawings.append(
            {
                "drawing_key": key,
                "logical_source": record.get("logical_source"),
                "source_sha256": record.get("source_sha256"),
                "mlight_index_sha256": record.get("mlight_index_sha256"),
                "snapshot_id": record.get("snapshot_id"),
                "layers": layers,
                "coverage": coverage if isinstance(coverage, Mapping) else {},
                "conformance": conformance if isinstance(conformance, Mapping) else None,
                "capability_gaps": gaps if isinstance(gaps, list) else [],
                "facts_paths": (
                    _ready_facts_paths(paths, layers)
                    if isinstance(paths, Mapping)
                    else {}
                ),
                "integrity_errors": integrity_errors,
                "last_error": record.get("last_error"),
            }
        )
    if selected_key is not None and not drawings:
        return {
            "project_id": state["project_id"],
            "drawing_key": selected_key,
            "status": "missing",
            "drawings": [],
            "building": False,
            "facts_paths": {
                "project_index": layout.relative(layout.project_index),
                "project_json": layout.relative(layout.project_json),
            },
        }
    return {
        "project_id": state["project_id"],
        "status": (
            "ready"
            if drawings and all(item["layers"]["l4"] == "ready" for item in drawings)
            else "partial" if drawings else "missing"
        ),
        "drawings": drawings,
        "binding": (
            None
            if binding is None
            else {
                "project_snapshot_set_id": binding.project_snapshot_set_id,
                "source_count": len(binding.sources),
            }
        ),
        "binding_errors": binding_errors,
        "facts_paths": {
            "project_index": layout.relative(layout.project_index),
            "project_json": layout.relative(layout.project_json),
            "binding": layout.relative(layout.binding_json),
            "menu": layout.relative(layout.menu_root / "index.txt"),
        },
    }
