"""Read the active AutoCAD database through COM without modifying the drawing.

The capture traverses every AutoCAD Blocks collection record: model space, paper
space, ordinary block definitions, anonymous blocks, and loaded xref definitions.
Those are authored database entities, not recursively expanded block occurrences.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import subprocess
import sys
import time
import uuid
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


SCHEMA_VERSION = 1
SCOPE = "database_authored_entities"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def atomic_write(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}-{uuid.uuid4().hex}.tmp")
    try:
        with temporary.open("xb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def json_bytes(value: Any) -> bytes:
    return f"{json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True)}\n".encode("utf-8")


def normalized_windows_path(value: str | Path) -> str:
    return os.path.normcase(os.path.abspath(os.fspath(value))).rstrip("\\/")


def safe_com_attr(value: object, name: str, default: object = None) -> object:
    try:
        return getattr(value, name)
    except Exception:
        return default


def git_revision(workspace_root: Path) -> str | None:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=workspace_root,
            check=True,
            capture_output=True,
            text=True,
            timeout=10,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    return result.stdout.strip() or None


def owner_context(block: object, index: int) -> dict[str, object]:
    name = str(safe_com_attr(block, "Name", "") or "")
    is_layout = bool(safe_com_attr(block, "IsLayout", False))
    is_xref = bool(safe_com_attr(block, "IsXRef", False))
    layout_name: str | None = None
    if is_layout:
        layout = safe_com_attr(block, "Layout")
        layout_name = str(safe_com_attr(layout, "Name", "") or "") or None
    if name.upper() == "*MODEL_SPACE" or (layout_name or "").casefold() == "model":
        owner_scope = "model_space"
    elif is_layout or name.upper().startswith("*PAPER_SPACE"):
        owner_scope = "paper_space"
    else:
        owner_scope = "block_definition"
    return {
        "owner_scope": owner_scope,
        "owner_block_index": index,
        "owner_block_name": name,
        "owner_block_handle": str(safe_com_attr(block, "Handle", "") or "").upper(),
        "owner_layout_name": layout_name,
        "owner_is_xref": is_xref,
        "owner_xref_path": str(safe_com_attr(block, "Path", "") or "") or None,
    }


def readable_markdown(
    drawing_name: str,
    records: list[dict[str, object]],
    summary: dict[str, object],
) -> str:
    def rows(mapping: dict[str, int]) -> list[str]:
        return [
            f"| {key.replace('|', '\\|')} | {count} |"
            for key, count in sorted(mapping.items(), key=lambda item: (-item[1], item[0]))
        ]

    type_counts = summary["type_counts"]
    layer_counts = summary["layer_counts"]
    owner_counts = summary["owner_scope_counts"]
    assert isinstance(type_counts, dict)
    assert isinstance(layer_counts, dict)
    assert isinstance(owner_counts, dict)
    lines = [
        "# AutoCAD COM Entity Capture",
        "",
        f"- drawing: `{drawing_name}`",
        f"- scope: `{SCOPE}`",
        f"- source entities: {summary['source_entity_count']}",
        f"- serialized entities: {summary['indexed_entity_count']}",
        f"- failed entities: {summary['failed_entity_count']}",
        "- semantics: authored database entities; block references are not recursively expanded",
        "",
        "## Owner scopes",
        "",
        "| scope | count |",
        "| --- | ---: |",
        *rows(owner_counts),
        "",
        "## Entity types",
        "",
        "| type | count |",
        "| --- | ---: |",
        *rows(type_counts),
        "",
        "## Layers (top 300)",
        "",
        "| layer | count |",
        "| --- | ---: |",
        *rows(dict(list(sorted(layer_counts.items(), key=lambda item: (-item[1], item[0])))[:300])),
        "",
        "## Entity samples (top 100)",
        "",
        "| handle | type | layer | owner scope | owner block | bbox |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for record in records[:100]:
        cells = [
            record.get("handle", ""),
            record.get("type", ""),
            record.get("layer", ""),
            record.get("owner_scope", ""),
            record.get("owner_block_name", ""),
            json.dumps(record.get("bbox"), ensure_ascii=False, separators=(",", ":")),
        ]
        lines.append("| " + " | ".join(str(cell).replace("|", "\\|").replace("\n", " ") for cell in cells) + " |")
    return "\n".join(lines) + "\n"


def ensure_output_available(output: Path, overwrite: bool) -> None:
    protected = [
        "entities.raw.jsonl",
        "entities.readable.md",
        "summary.json",
        "provenance.json",
        "errors.jsonl",
    ]
    existing = [name for name in protected if (output / name).exists()]
    if existing and not overwrite:
        raise RuntimeError(
            f"output already contains capture artifacts ({', '.join(existing)}); "
            "pass --overwrite to replace this channel explicitly"
        )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--expect-path", required=True, type=Path, help="Expected active DWG/DXF path")
    parser.add_argument("--output", required=True, type=Path, help="Channel output directory")
    parser.add_argument(
        "--serializer-root",
        type=Path,
        help="Directory containing the xiaoliang_cad_bridge Python package",
    )
    parser.add_argument("--overwrite", action="store_true", help="Replace existing channel artifacts")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    expected_path = args.expect_path.resolve(strict=True)
    output = args.output.resolve()
    ensure_output_available(output, args.overwrite)

    workspace_root = Path(__file__).resolve().parents[2]
    serializer_root = (
        args.serializer_root.resolve()
        if args.serializer_root
        else workspace_root
        / "dev"
        / "frontend"
        / "electron"
        / "runtime"
        / "cad"
        / "drivers"
        / "autocad-http"
        / "python"
    )
    if not serializer_root.is_dir():
        raise RuntimeError(f"AutoCAD serializer package not found: {serializer_root}")
    sys.path.insert(0, str(serializer_root))

    import pythoncom  # type: ignore[import-not-found]
    import win32com.client  # type: ignore[import-not-found]

    from xiaoliang_cad_bridge.infrastructure.autocad.serializer import serialize_entity

    started_at = utc_now()
    started = time.perf_counter()
    disk_stat = expected_path.stat()
    disk_hash = sha256_file(expected_path)
    script_path = Path(__file__).resolve()

    records: list[dict[str, object]] = []
    errors: list[dict[str, object]] = []
    type_counts: Counter[str] = Counter()
    layer_counts: Counter[str] = Counter()
    owner_scope_counts: Counter[str] = Counter()
    owner_block_counts: Counter[str] = Counter()
    block_inventory: list[dict[str, object]] = []
    source_entity_count = 0

    pythoncom.CoInitialize()
    try:
        app = win32com.client.GetActiveObject("AutoCAD.Application")
        document = app.ActiveDocument
        active_path = Path(str(document.FullName)).resolve()
        if normalized_windows_path(active_path) != normalized_windows_path(expected_path):
            raise RuntimeError(
                "active AutoCAD drawing does not match --expect-path: "
                f"active={active_path}; expected={expected_path}"
            )

        application_version = str(safe_com_attr(app, "Version", "") or "")
        document_saved = bool(safe_com_attr(document, "Saved", False))
        document_read_only = bool(safe_com_attr(document, "ReadOnly", False))
        try:
            dbmod = int(document.GetVariable("DBMOD"))
        except Exception:
            dbmod = None
        try:
            active_layout = str(document.ActiveLayout.Name)
        except Exception:
            active_layout = None

        blocks = document.Blocks
        block_count = int(blocks.Count)
        for block_index in range(block_count):
            block = blocks.Item(block_index)
            context = owner_context(block, block_index)
            declared_count = int(safe_com_attr(block, "Count", 0) or 0)
            serialized_in_block = 0
            failed_in_block = 0
            for entity_index in range(declared_count):
                source_entity_count += 1
                try:
                    entity = block.Item(entity_index)
                    record = serialize_entity(entity, include_geometry=True)
                    record.update(context)
                    record["owner_entity_index"] = entity_index
                    record["capture_scope"] = SCOPE
                    record["entity_key"] = (
                        f"{context['owner_block_name']}::{str(record.get('handle') or '').upper()}"
                    )
                    records.append(record)
                    type_counts[str(record.get("type") or "unknown")] += 1
                    layer_counts[str(record.get("layer") or "(empty)")] += 1
                    owner_scope_counts[str(context["owner_scope"])] += 1
                    owner_block_counts[str(context["owner_block_name"])] += 1
                    serialized_in_block += 1
                except Exception as error:
                    failed_in_block += 1
                    errors.append(
                        {
                            "owner_block_index": block_index,
                            "owner_block_name": context["owner_block_name"],
                            "owner_entity_index": entity_index,
                            "error_type": type(error).__name__,
                            "error": str(error)[:2_048],
                        }
                    )
            block_inventory.append(
                {
                    **context,
                    "declared_entity_count": declared_count,
                    "serialized_entity_count": serialized_in_block,
                    "failed_entity_count": failed_in_block,
                }
            )

        elapsed_ms = round((time.perf_counter() - started) * 1_000, 1)
        summary: dict[str, object] = {
            "schema_version": SCHEMA_VERSION,
            "channel": "autocad-com",
            "capture_scope": SCOPE,
            "source_entity_count": source_entity_count,
            "indexed_entity_count": len(records),
            "failed_entity_count": len(errors),
            "block_record_count": block_count,
            "owner_scope_counts": dict(owner_scope_counts),
            "owner_block_counts": dict(owner_block_counts),
            "type_counts": dict(type_counts),
            "layer_counts": dict(layer_counts),
            "elapsed_ms": elapsed_ms,
        }
        source_matches_memory_claim = "not_verified" if document_saved else "dirty_active_document"
        provenance = {
            "schema_version": SCHEMA_VERSION,
            "channel": "autocad-com",
            "capture_scope": SCOPE,
            "capture_semantics": "authored database entities; block references are not expanded",
            "started_at": started_at,
            "completed_at": utc_now(),
            "source": {
                "path": str(expected_path),
                "sha256": disk_hash,
                "size_bytes": disk_stat.st_size,
                "mtime_utc": datetime.fromtimestamp(disk_stat.st_mtime, timezone.utc)
                .isoformat()
                .replace("+00:00", "Z"),
            },
            "active_document": {
                "name": str(document.Name),
                "full_name": str(active_path),
                "saved": document_saved,
                "dbmod": dbmod,
                "read_only": document_read_only,
                "active_layout": active_layout,
                "disk_snapshot_relationship": source_matches_memory_claim,
            },
            "producer": {
                "application": "AutoCAD",
                "application_version": application_version,
                "python": sys.version,
                "platform": platform.platform(),
                "script": str(script_path),
                "script_sha256": sha256_file(script_path),
                "serializer_root": str(serializer_root),
                "git_revision": git_revision(workspace_root),
            },
            "block_inventory": block_inventory,
        }
    finally:
        pythoncom.CoUninitialize()

    raw = b"".join(
        f"{json.dumps(record, ensure_ascii=False, separators=(',', ':'))}\n".encode("utf-8")
        for record in records
    )
    error_content = b"".join(
        f"{json.dumps(error, ensure_ascii=False, separators=(',', ':'))}\n".encode("utf-8")
        for error in errors
    )
    atomic_write(output / "entities.raw.jsonl", raw)
    atomic_write(output / "entities.readable.md", readable_markdown(expected_path.name, records, summary).encode("utf-8"))
    atomic_write(output / "summary.json", json_bytes(summary))
    atomic_write(output / "provenance.json", json_bytes(provenance))
    atomic_write(output / "errors.jsonl", error_content)

    print(
        json.dumps(
            {
                "ok": True,
                "output": str(output),
                "source_entity_count": source_entity_count,
                "indexed_entity_count": len(records),
                "failed_entity_count": len(errors),
                "document_saved": provenance["active_document"]["saved"],  # type: ignore[index]
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
