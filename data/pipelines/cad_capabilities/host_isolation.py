from __future__ import annotations

from pathlib import Path
from typing import Any

AUTOCAD_HOST_ID = "autocad-2024"
THCAD_INVENTORY_MARKER = "thcad-v24"
FOREIGN_RUNTIME_NEEDLES = (
    "thcad",
    "teigha",
    "th_xuhaoentity",
    "xuhaoentity",
    "bricscad",
    "thsoft",
)


class HostIsolationError(ValueError):
    pass


def is_autocad_host_id(value: str | None) -> bool:
    return (value or "") == AUTOCAD_HOST_ID


def is_autocad_inventory_id(value: str | None) -> bool:
    return (value or "").startswith("autocad-2024.")


def is_autocad_atom(atom: dict[str, Any]) -> bool:
    host_ids = atom.get("observed_host_ids") or []
    return AUTOCAD_HOST_ID in host_ids


def _normalized_path(value: str | Path) -> str:
    return str(value).replace("\\", "/").casefold()


def mentions_thcad_inventory(value: str | Path) -> bool:
    text = _normalized_path(value)
    name = Path(str(value)).name.casefold()
    return THCAD_INVENTORY_MARKER in name or f"/{THCAD_INVENTORY_MARKER}" in f"/{text}"


def assert_autocad_output_not_thcad(inventory_id: str, output_dir: str | Path) -> None:
    if mentions_thcad_inventory(inventory_id) or mentions_thcad_inventory(output_dir):
        raise HostIsolationError(
            f"AutoCAD 输出拒绝指向 thcad-v24.*: inventory_id={inventory_id} output_dir={output_dir}"
        )


def guard_inventory_write(
    inventory_id: str,
    observed_host_id: str,
    output_dir: str | Path,
) -> None:
    autocad_write = is_autocad_host_id(observed_host_id) or is_autocad_inventory_id(inventory_id)
    if not autocad_write:
        return
    if not is_autocad_host_id(observed_host_id):
        raise HostIsolationError(
            f"AutoCAD inventory requires observed_host_id={AUTOCAD_HOST_ID}, got {observed_host_id!r}"
        )
    if not is_autocad_inventory_id(inventory_id):
        raise HostIsolationError(
            f"AutoCAD host cannot write inventory_id={inventory_id!r}"
        )
    assert_autocad_output_not_thcad(inventory_id, output_dir)


def is_foreign_host_runtime_evidence(item: dict[str, Any]) -> bool:
    blob = " ".join(str(item.get(key) or "") for key in ("kind", "ref", "claim")).casefold()
    return any(needle in blob for needle in FOREIGN_RUNTIME_NEEDLES)


def isolate_autocad_enrichment(atom: dict[str, Any], enrichment: dict[str, Any]) -> dict[str, Any]:
    if not is_autocad_atom(atom):
        return enrichment
    enrichment["semantic_candidates"] = []
    enrichment["evidence"] = [
        item
        for item in (enrichment.get("evidence") or [])
        if not is_foreign_host_runtime_evidence(item)
    ]
    processor = dict(enrichment.get("processor") or {})
    surface = str(atom.get("surface") or "atom")
    processor["run_id"] = f"autocad-2024.{surface}.kind-rules.v1"
    enrichment["processor"] = processor
    notes = enrichment.get("notes")
    if isinstance(notes, str) and any(needle in notes for needle in ("TH_", "THCAD", "Teigha", "BricsCAD")):
        enrichment["notes"] = (
            "参数协议与真实效果未在元数据阶段验证；不得把其他宿主运行时证据附加到本原子。"
        )
    return enrichment
