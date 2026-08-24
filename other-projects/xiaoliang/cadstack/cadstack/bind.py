from __future__ import annotations

from pathlib import Path
import shutil
import tempfile
from typing import Any, Mapping

from cadtasks.agentview import write_menu
from cadtasks.binding import ProjectBinding

from cadstack.layout import FactsLayout
from cadstack.state import (
    atomic_write_text,
    binding_lock,
    read_project_state,
    record_failure,
    replace_generated_tree,
    save_project_state,
    state_lock,
    utc_now,
)


def binding_integrity_errors(
    layout: FactsLayout,
    binding: ProjectBinding,
    *,
    expected_project_id: str | None = None,
) -> list[str]:
    errors: list[str] = []
    try:
        errors.extend(binding.verify())
    except (OSError, TypeError, ValueError) as error:
        errors.append(f"binding verification failed: {error}")
    if expected_project_id is not None and binding.project_id != expected_project_id:
        errors.append("binding project_id does not match facts project.json")
    roots = {
        "snapshot_path": layout.snapshots_root.resolve(strict=False),
        "pattern_path": layout.patterns_root.resolve(strict=False),
        "semantic_path": layout.semantics_root.resolve(strict=False),
    }
    for index, source in enumerate(binding.sources):
        for attribute, root in roots.items():
            try:
                candidate = Path(getattr(source, attribute)).resolve(strict=True)
                candidate.relative_to(root)
            except (AttributeError, OSError, ValueError):
                errors.append(
                    f"binding source {index} {attribute} escapes its project facts store"
                )
    return sorted(set(errors))


def _source_tuple(
    layout: FactsLayout,
    record: Mapping[str, Any],
) -> tuple[Path, Path, Path]:
    stores = record.get("stores", {})
    if not isinstance(stores, Mapping):
        raise ValueError("drawing stores must be an object")
    values = []
    for name in ("snapshot", "pattern", "semantic"):
        value = stores.get(name)
        if not isinstance(value, str):
            raise ValueError(f"drawing has no {name} store")
        values.append(layout.resolve_input_path(value, require_file=False))
    return values[0], values[1], values[2]


def _record_bind_failure(layout: FactsLayout, error: BaseException) -> None:
    # bind has no --drawing-key CLI context, so it records its own failure the
    # way build_drawing does: every L3-ready drawing was a binding candidate
    # and must surface l4 failed instead of looking merely unbuilt. Recording
    # must never mask the original error.
    try:
        state = read_project_state(layout)
        keys = [
            key
            for key, record in state["drawings"].items()
            if isinstance(record, Mapping)
            and isinstance(record.get("layers"), Mapping)
            and record["layers"].get("l3") == "ready"
        ]
    except Exception:
        return
    for key in keys:
        try:
            record_failure(layout, key, "l4", error)
        except Exception:
            pass


def bind_project(*, project_root: str | Path) -> dict[str, Any]:
    layout = FactsLayout.from_project_root(project_root)
    layout.ensure()
    with binding_lock(layout):
        try:
            state = read_project_state(layout)
            selected: list[tuple[str, tuple[Path, Path, Path]]] = []
            for key in sorted(state["drawings"]):
                record = state["drawings"][key]
                if not isinstance(record, Mapping):
                    continue
                layers = record.get("layers", {})
                if not isinstance(layers, Mapping) or layers.get("l3") != "ready":
                    continue
                selected.append((key, _source_tuple(layout, record)))
            if not selected:
                raise ValueError("no L3-ready drawings are available for project binding")
            binding = ProjectBinding.bind(
                project_id=str(state["project_id"]),
                sources=(source for _, source in selected),
            )
            round_tripped = ProjectBinding.from_json(binding.to_json())
            if round_tripped != binding or binding_integrity_errors(
                layout,
                binding,
                expected_project_id=str(state["project_id"]),
            ):
                raise ValueError("ProjectBinding failed its round-trip integrity check")
            staging = Path(tempfile.mkdtemp(prefix=".menu-", dir=layout.facts_root))
            try:
                write_menu(binding, staging)
                selected_signature = [
                    (key, tuple(str(path.resolve()) for path in source))
                    for key, source in selected
                ]
                with state_lock(layout):
                    current = read_project_state(layout)
                    current_selected: list[tuple[str, tuple[str, str, str]]] = []
                    for key in sorted(current["drawings"]):
                        record = current["drawings"][key]
                        if not isinstance(record, Mapping):
                            continue
                        layers = record.get("layers", {})
                        if not isinstance(layers, Mapping) or layers.get("l3") != "ready":
                            continue
                        source = _source_tuple(layout, record)
                        current_selected.append(
                            (key, tuple(str(path.resolve()) for path in source))
                        )
                    if current_selected != selected_signature:
                        raise RuntimeError(
                            "L3 drawing set changed while binding was building; retry cadstack bind"
                        )

                    atomic_write_text(
                        layout.binding_json,
                        binding.to_json(pretty=True) + "\n",
                    )
                    replace_generated_tree(staging, layout.menu_root)
                    bound_keys = {key for key, _ in selected}
                    for key, record in current["drawings"].items():
                        if not isinstance(record, dict):
                            continue
                        layers = dict(record.get("layers", {}))
                        layers["l4"] = "ready" if key in bound_keys else "missing"
                        record["layers"] = layers
                        record["updated_at"] = utc_now()
                        if key in bound_keys:
                            # A successful bind resolves only the drawings it bound;
                            # unbound drawings keep the L1-L3 failure that held them back.
                            record.pop("last_error", None)
                    current["binding"] = {
                        "project_snapshot_set_id": binding.project_snapshot_set_id,
                        "source_count": len(binding.sources),
                        "path": layout.relative(layout.binding_json),
                        "menu_path": layout.relative(layout.menu_root / "index.txt"),
                    }
                    save_project_state(layout, current)
            finally:
                if staging.exists():
                    shutil.rmtree(staging, ignore_errors=True)
        except Exception as error:
            _record_bind_failure(layout, error)
            raise
    return {
        "project_id": binding.project_id,
        "project_snapshot_set_id": binding.project_snapshot_set_id,
        "drawing_keys": sorted(bound_keys),
        "source_count": len(binding.sources),
        "facts_paths": {
            "binding": layout.relative(layout.binding_json),
            "menu": layout.relative(layout.menu_root / "index.txt"),
            "project_index": layout.relative(layout.project_index),
            "project_json": layout.relative(layout.project_json),
        },
    }
