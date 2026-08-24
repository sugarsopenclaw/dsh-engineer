"""COM extraction fallback and project-local readable artifacts.

Adapted from pi-engineering engineering/cad-bridge at
9bddd7f1f75f7dd427b6cabe5fb1cbd04ad398ff (MIT).
"""

from __future__ import annotations

import fnmatch
import json
import os
import tempfile
from collections import Counter
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from xiaoliang_cad_bridge.errors import raise_if_call_rejected
from xiaoliang_cad_bridge.infrastructure.autocad.serializer import (
    GEOMETRY_TYPES,
    entity_text_fragments,
    object_type,
    safe_attr,
    serialize_entity,
)
from xiaoliang_cad_bridge.paths import drawing_artifact_directory, project_relative


TEXT_FREQUENCY_LIMIT = 2_500
SPATIAL_ANCHOR_LIMIT = 1_200
ENTITY_SAMPLE_LIMIT = 400
LAYER_LIMIT = 300
GEOMETRY_SAMPLE_LIMIT = 80


@dataclass(frozen=True)
class ExtractFilters:
    layers: tuple[str, ...] = ()
    types: tuple[str, ...] = ()
    text_pattern: str | None = None
    include_geometry: bool = False


@dataclass
class ExtractedRecords:
    records: list[dict[str, object]]
    type_counts: Counter[str]
    layer_counts: Counter[str]
    source_entity_count: int
    omitted_geometry_count: int
    failed_count: int
    warnings: list[str]


def matches_patterns(value: str, patterns: Sequence[str]) -> bool:
    return not patterns or any(fnmatch.fnmatch(value.casefold(), pattern.casefold()) for pattern in patterns)


def extract_records(entities: Iterable[object], filters: ExtractFilters) -> ExtractedRecords:
    records: list[dict[str, object]] = []
    type_counts: Counter[str] = Counter()
    layer_counts: Counter[str] = Counter()
    warnings: list[str] = []
    source_entity_count = 0
    omitted_geometry_count = 0
    failed_count = 0
    geometry_samples = 0
    for entity in entities:
        source_entity_count += 1
        try:
            if not bool(safe_attr(entity, "Visible", True)):
                continue
            layer = str(safe_attr(entity, "Layer", "") or "")[:1_024]
            if layer.casefold() == "defpoints" or not matches_patterns(layer, filters.layers):
                continue
            _object_name, type_name = object_type(entity)
            if not matches_patterns(type_name, filters.types):
                continue
            is_geometry = type_name in GEOMETRY_TYPES
            include_full_geometry = filters.include_geometry or not is_geometry
            record = serialize_entity(entity, include_geometry=include_full_geometry)
            text = " ".join(entity_text_fragments(record))
            if filters.text_pattern and not fnmatch.fnmatch(text.casefold(), filters.text_pattern.casefold()):
                continue
            type_counts[type_name] += 1
            layer_counts[layer or "(empty)"] += 1
            if is_geometry and not filters.include_geometry:
                omitted_geometry_count += 1
                if geometry_samples >= GEOMETRY_SAMPLE_LIMIT:
                    continue
                geometry_samples += 1
                record["geometry_sample"] = True
            records.append(record)
        except Exception as error:
            raise_if_call_rejected(error)
            failed_count += 1
            warnings.append(f"entity {source_entity_count} could not be serialized: {type(error).__name__}")
    return ExtractedRecords(
        records=records,
        type_counts=type_counts,
        layer_counts=layer_counts,
        source_entity_count=source_entity_count,
        omitted_geometry_count=omitted_geometry_count,
        failed_count=failed_count,
        warnings=warnings[:200],
    )


def markdown_cell(value: object) -> str:
    return " ".join(str(value or "").replace("|", "\\|").split())


def markdown_table(headers: Sequence[str], rows: Iterable[Sequence[object]]) -> list[str]:
    lines = [
        f"| {' | '.join(map(markdown_cell, headers))} |",
        f"| {' | '.join('---' for _ in headers)} |",
    ]
    lines.extend(f"| {' | '.join(map(markdown_cell, row))} |" for row in rows)
    return lines


def record_point(record: dict[str, object]) -> object:
    for key in (
        "position",
        "text_position",
        "insert_point",
        "center",
        "start",
        "point1",
        "point2",
    ):
        if record.get(key) is not None:
            return record[key]
    return ""


def render_readable_markdown(drawing_name: str, extracted: ExtractedRecords) -> str:
    text_counts: Counter[str] = Counter()
    anchors: list[tuple[object, ...]] = []
    for record in extracted.records:
        fragments = entity_text_fragments(record)
        text_counts.update(fragments)
        if fragments or record.get("bbox") or record_point(record):
            anchors.append(
                (
                    " / ".join(fragments),
                    record.get("handle", ""),
                    record.get("type", ""),
                    record.get("layer", ""),
                    record_point(record),
                    record.get("bbox", ""),
                )
            )
    type_rows = sorted(extracted.type_counts.items(), key=lambda item: (-item[1], item[0]))
    layer_rows = sorted(extracted.layer_counts.items(), key=lambda item: (-item[1], item[0]))[:LAYER_LIMIT]
    text_rows = sorted(text_counts.items(), key=lambda item: (-item[1], item[0]))[:TEXT_FREQUENCY_LIMIT]
    samples = extracted.records[:ENTITY_SAMPLE_LIMIT]
    lines = [
        "# CAD Entity Index",
        "",
        "schema_version: 1",
        f"drawing_name: {markdown_cell(drawing_name)}",
        f"source_entity_count: {extracted.source_entity_count}",
        f"indexed_entity_count: {len(extracted.records)}",
        f"omitted_geometry_count: {extracted.omitted_geometry_count}",
        f"failed_entity_count: {extracted.failed_count}",
        f"exported_at: {datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')}",
        "",
        "## Entity Type Counts",
        *markdown_table(("type", "count"), type_rows),
        "",
        "## Layer Counts",
        *markdown_table(("layer", "count"), layer_rows),
        "",
        "## Text Frequency (selected)",
        *markdown_table(("text", "count"), text_rows),
        "",
        "## Text And Spatial Anchors",
        *markdown_table(("text", "handle", "type", "layer", "point", "bbox"), anchors[:SPATIAL_ANCHOR_LIMIT]),
        "",
        f"## Entity Samples (top {ENTITY_SAMPLE_LIMIT})",
        *markdown_table(
            ("index", "handle", "type", "layer", "text", "point", "bbox"),
            (
                (
                    index,
                    record.get("handle", ""),
                    record.get("type", ""),
                    record.get("layer", ""),
                    " / ".join(entity_text_fragments(record)),
                    record_point(record),
                    record.get("bbox", ""),
                )
                for index, record in enumerate(samples, 1)
            ),
        ),
    ]
    return "\n".join(lines) + "\n"


def atomic_write(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}-", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def write_extraction(
    project_root: Path,
    drawing_name: str,
    extracted: ExtractedRecords,
    *,
    drawing_relative_path: str | None = None,
    output_directory: Path | None = None,
) -> dict[str, object]:
    directory = output_directory or (
        drawing_artifact_directory(project_root, drawing_name, drawing_relative_path or drawing_name)
        / "entities"
    )
    raw_path = directory / "entities.raw.jsonl"
    readable_path = directory / "entities.readable.md"
    raw_content = b"".join(
        f"{json.dumps(record, ensure_ascii=False, separators=(',', ':'))}\n".encode("utf-8")
        for record in extracted.records
    )
    atomic_write(raw_path, raw_content)
    atomic_write(readable_path, render_readable_markdown(drawing_name, extracted).encode("utf-8"))
    return {
        "raw_path": project_relative(project_root, raw_path),
        "readable_path": project_relative(project_root, readable_path),
        "source_entity_count": extracted.source_entity_count,
        "indexed_entity_count": len(extracted.records),
        "omitted_geometry_count": extracted.omitted_geometry_count,
        "failed_entity_count": extracted.failed_count,
        "type_counts": dict(extracted.type_counts),
        "layer_count": len(extracted.layer_counts),
    }
