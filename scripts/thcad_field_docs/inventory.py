"""Build the THCAD extract field inventory from real JSON + extractor maps."""

from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path
from typing import Any, Iterable

from .paths import DRAWING_NAMES, EXTRACTOR_CS, OUT_THCAD

# Keys the extractor always puts on an entity record (SerializeEntity).
EXTRACTOR_ENTITY_KEYS = (
    "drawing_handle",
    "handle",
    "runtime_class",
    "managed_type",
    "dxf_name",
    "semantic_type",
    "layer",
    "color",
    "linetype",
    "lineweight",
    "visible",
    "owner_scope",
    "owner_block_name",
    "owner_handle",
    "block_path",
    "bbox",
    "geometry",
    "text",
    "attributes",
    "xdata",
    "extension_dictionary",
    "source",
    "decode_status",
    "custom",
    "proxy",
)

EXTRACTOR_COLOR_KEYS = ("index", "is_by_layer", "is_by_block", "name")
EXTRACTOR_BBOX_KEYS = ("min", "max")
EXTRACTOR_ATTR_KEYS = ("handle", "tag", "value", "invisible", "position")
EXTRACTOR_TEXT_OBJECT_KEYS = (
    "contents",
    "plain",
    "tag",
    "prompt",
    "value",
    "dimension_text",
    "measurement",
)
EXTRACTOR_PROXY_KEYS = (
    "original_class_name",
    "original_dxf_name",
    "application_description",
    "proxy_flags",
)
EXTRACTOR_CUSTOM_KEYS = (
    "managed_type",
    "rx",
    "explode",
    "explode_count",
    "explode_error",
    "properties",
)
EXTRACTOR_EXPLODE_ITEM_KEYS = (
    "kind",
    "string",
    "position",
    "height",
    "contents",
    "plain",
    "rx",
    "layer",
    "bbox",
)
EXTRACTOR_GEOMETRY_KEYS = (
    "kind",
    "start",
    "end",
    "center",
    "radius",
    "normal",
    "start_angle",
    "end_angle",
    "major_axis",
    "radius_ratio",
    "closed",
    "elevation",
    "constant_width",
    "vertex_count",
    "vertices_truncated",
    "vertices",
    "degree",
    "control_point_count",
    "control_points_truncated",
    "control_points",
    "position",
    "height",
    "rotation",
    "alignment",
    "horizontal_mode",
    "location",
    "width",
    "attachment",
    "block_name",
    "scale",
    "is_dynamic",
    "pattern",
    "pattern_type",
    "associative",
    "hatch_style",
    "dim_type",
    "measurement",
    "text_position",
    "dim_style",
    "has_arrow_head",
    "rows",
    "columns",
    "number",
    "on",
    "custom_scale",
    "tag",
    "invisible",
    "rx",
    "custom",
    "managed_type",
    "error",
)
EXTRACTOR_EXT_DICT_KEYS = ("handle", "runtime_class", "is_proxy", "count", "items", "error")
EXTRACTOR_DICT_TOP_KEYS = ("key", "object", "error")
EXTRACTOR_DICT_OBJECT_KEYS = (
    "kind",
    "handle",
    "runtime_class",
    "managed_type",
    "is_proxy",
    "count",
    "items",
    "data",
    "truncated",
    "error",
)
EXTRACTOR_ERROR_KEYS = ("handle", "owner_block_name", "error", "error_type")
EXTRACTOR_DRAWING_KEYS = (
    "schema_version",
    "drawing_id",
    "source_path",
    "filename",
    "source",
    "tile_mode",
    "measurement",
    "insunits",
    "original_file_version",
    "last_saved_as_version",
    "block_inventory",
)
EXTRACTOR_REPORT_KEYS = (
    "schema_version",
    "source",
    "drawing_id",
    "source_path",
    "source_sha256",
    "source_size_bytes",
    "started_at",
    "completed_at",
    "elapsed_ms",
    "host",
    "entity_count",
    "proxy_count",
    "failed_count",
    "did_not_save",
    "type_counts",
    "layer_counts",
    "owner_scope_counts",
    "decode_status_counts",
    "semantic_title_blocks",
    "semantic_bom_rows",
    "semantic_pc_blocks",
    "semantic_professional_entities",
    "output_dir",
)
EXTRACTOR_HOST_KEYS = (
    "application",
    "application_version",
    "plugin",
    "plugin_version",
    "clr",
    "machine",
)
EXTRACTOR_SEMANTIC_TOP = (
    "schema_version",
    "source",
    "drawing_id",
    "title_blocks",
    "bom_rows",
    "other_pc_blocks",
    "professional_entities",
)
EXTRACTOR_SEMANTIC_BLOCK_KEYS = (
    "kind",
    "handle",
    "block_name",
    "position",
    "xdata",
    "fields",
)
EXTRACTOR_PROF_KEYS = ("handle", "runtime_class", "layer", "bbox", "xdata", "custom")
EXTRACTOR_LINK_TOP = (
    "schema_version",
    "source",
    "drawing_id",
    "note",
    "link_count",
    "all_xuhao_matched",
    "links",
)
EXTRACTOR_LINK_ITEM = (
    "seq",
    "xuhao_handle",
    "xuhao_found",
    "bom_handle",
    "bom_code",
    "bom_name",
    "bom_qty",
    "bom_material",
    "dict_key",
    "recorder_handle",
    "recorder_class",
)

TABLE_COLUMNS = {
    "layer": ("name", "handle", "off", "frozen", "locked", "color", "linetype"),
    "linetype": ("name", "handle", "ascii_description"),
    "text_style": ("name", "handle", "font_file", "big_font_file", "text_size"),
    "dim_style": ("name", "handle"),
    "reg_app": ("name", "handle"),
    "layout": ("name", "handle", "tab_order", "model_type", "block_handle"),
    "block": (
        "name",
        "handle",
        "owner_scope",
        "is_layout",
        "is_anonymous",
        "is_from_xref",
        "xref_path",
        "has_attribute_definitions",
        "entity_count",
        "origin",
    ),
}

TABLE_JSON_SECTION = {
    "layer": "layers",
    "linetype": "linetypes",
    "text_style": "text_styles",
    "dim_style": "dim_styles",
    "reg_app": "reg_apps",
    "layout": "layouts",
    "block": "blocks",
}


def load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def iter_jsonl(path: Path) -> Iterable[dict]:
    if not path.exists() or path.stat().st_size == 0:
        return
        yield  # make this a generator even when empty
    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            yield json.loads(line)


def clip(value: Any, n: int = 180) -> str:
    if value is None:
        return "null"
    if isinstance(value, (dict, list)):
        text = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    else:
        text = str(value)
    text = text.replace("\n", " ")
    if len(text) > n:
        return text[: n - 1] + "…"
    return text


def drawing_dirs() -> list[Path]:
    dirs = []
    for name in DRAWING_NAMES:
        p = OUT_THCAD / name
        if not (p / "extraction-report.json").exists():
            raise FileNotFoundError(f"missing extract: {p}")
        dirs.append(p)
    return dirs


class FieldObs:
    __slots__ = (
        "field_id",
        "verbatim",
        "json_path",
        "source_file",
        "scope",
        "in_extractor",
        "present",
        "examples",
        "empty_examples",
        "notes",
        "counts",
    )

    def __init__(
        self,
        field_id: str,
        verbatim: str,
        json_path: str,
        source_file: str,
        scope: str,
        in_extractor: bool = False,
    ):
        self.field_id = field_id
        self.verbatim = verbatim
        self.json_path = json_path
        self.source_file = source_file
        self.scope = scope
        self.in_extractor = in_extractor
        self.present: set[str] = set()
        self.examples: list[str] = []
        self.empty_examples: list[str] = []
        self.notes: list[str] = []
        self.counts: dict[str, int] = defaultdict(int)

    def add_example(self, drawing: str, loc: str, value: Any, empty: bool = False) -> None:
        self.present.add(drawing)
        self.counts["seen"] += 1
        if empty:
            self.counts["empty"] += 1
            if len(self.empty_examples) < 4:
                self.empty_examples.append(f"{drawing} {loc}: {clip(value)}")
            return
        if len(self.examples) < 6:
            rendered = clip(value)
            item = f"{drawing} {loc}: {rendered}"
            if item not in self.examples:
                self.examples.append(item)

    def as_dict(self) -> dict:
        absent = [n for n in DRAWING_NAMES if n not in self.present]
        return {
            "id": self.field_id,
            "verbatim": self.verbatim,
            "json_path": self.json_path,
            "source_file": self.source_file,
            "scope": self.scope,
            "in_extractor": self.in_extractor,
            "in_data": bool(self.present) or self.counts["seen"] > 0,
            "present_drawings": sorted(self.present),
            "absent_drawings": absent,
            "examples": self.examples,
            "empty_examples": self.empty_examples,
            "notes": self.notes,
            "counts": dict(self.counts),
        }


def _ensure(fields: dict[str, FieldObs], **kwargs) -> FieldObs:
    fid = kwargs["field_id"]
    if fid not in fields:
        fields[fid] = FieldObs(**kwargs)
    return fields[fid]


def _is_empty(value: Any) -> bool:
    return value is None or value == "" or value == [] or value == {}


def build_inventory(out_root: Path | None = None) -> dict[str, dict]:
    """Walk extracts + extractor maps. Return {field_id: observation dict} in grain order."""
    root = out_root or OUT_THCAD
    fields: dict[str, FieldObs] = {}
    drawings = [root / name for name in DRAWING_NAMES]
    for p in drawings:
        if not (p / "extraction-report.json").exists():
            raise FileNotFoundError(f"missing extract: {p}")

    # --- register extractor-known keys so absent JSON keys still get an id ---
    for key in EXTRACTOR_DRAWING_KEYS:
        _ensure(
            fields,
            field_id=f"drawing.{key}",
            verbatim=key,
            json_path=f"drawing.json / {key}",
            source_file="drawing.json",
            scope="drawing",
            in_extractor=True,
        )
    for key in EXTRACTOR_REPORT_KEYS:
        _ensure(
            fields,
            field_id=f"report.{key}",
            verbatim=key,
            json_path=f"extraction-report.json / {key}",
            source_file="extraction-report.json",
            scope="report",
            in_extractor=True,
        )
    for key in EXTRACTOR_HOST_KEYS:
        _ensure(
            fields,
            field_id=f"report.host.{key}",
            verbatim=key,
            json_path=f"extraction-report.json / host.{key}",
            source_file="extraction-report.json",
            scope="report.host",
            in_extractor=True,
        )
    for table, cols in TABLE_COLUMNS.items():
        section = TABLE_JSON_SECTION[table]
        for col in cols:
            _ensure(
                fields,
                field_id=f"{table}.{col}",
                verbatim=col,
                json_path=f"tables.json / {section}[].{col}",
                source_file="tables.json",
                scope=table,
                in_extractor=True,
            )
    for key in EXTRACTOR_ENTITY_KEYS:
        _ensure(
            fields,
            field_id=f"entity.{key}",
            verbatim=key,
            json_path=f"entities.jsonl / {key}",
            source_file="entities.jsonl",
            scope="entity",
            in_extractor=True,
        )
    for key in EXTRACTOR_COLOR_KEYS:
        _ensure(
            fields,
            field_id=f"entity.color.{key}",
            verbatim=key,
            json_path=f"entities.jsonl / color.{key}",
            source_file="entities.jsonl",
            scope="entity.color",
            in_extractor=True,
        )
    for key in EXTRACTOR_BBOX_KEYS:
        _ensure(
            fields,
            field_id=f"entity.bbox.{key}",
            verbatim=key,
            json_path=f"entities.jsonl / bbox.{key}",
            source_file="entities.jsonl",
            scope="entity.bbox",
            in_extractor=True,
        )
    for key in EXTRACTOR_GEOMETRY_KEYS:
        _ensure(
            fields,
            field_id=f"entity.geometry.{key}",
            verbatim=key,
            json_path=f"entities.jsonl / geometry.{key}",
            source_file="entities.jsonl",
            scope="entity.geometry",
            in_extractor=True,
        )
    for key in EXTRACTOR_TEXT_OBJECT_KEYS:
        _ensure(
            fields,
            field_id=f"entity.text.{key}",
            verbatim=key,
            json_path=f"entities.jsonl / text.{key}",
            source_file="entities.jsonl",
            scope="entity.text",
            in_extractor=True,
        )
    for key in EXTRACTOR_ATTR_KEYS:
        _ensure(
            fields,
            field_id=f"entity.attributes.{key}",
            verbatim=key,
            json_path=f"entities.jsonl / attributes[].{key}",
            source_file="entities.jsonl",
            scope="entity.attributes",
            in_extractor=True,
        )
    for key in EXTRACTOR_PROXY_KEYS:
        _ensure(
            fields,
            field_id=f"entity.proxy.{key}",
            verbatim=key,
            json_path=f"entities.jsonl / proxy.{key}",
            source_file="entities.jsonl",
            scope="entity.proxy",
            in_extractor=True,
        )
    for key in EXTRACTOR_CUSTOM_KEYS:
        _ensure(
            fields,
            field_id=f"entity.custom.{key}",
            verbatim=key,
            json_path=f"entities.jsonl / custom.{key}",
            source_file="entities.jsonl",
            scope="entity.custom",
            in_extractor=True,
        )
    for key in EXTRACTOR_EXPLODE_ITEM_KEYS:
        _ensure(
            fields,
            field_id=f"entity.custom.explode.{key}",
            verbatim=key,
            json_path=f"entities.jsonl / custom.explode[].{key}",
            source_file="entities.jsonl",
            scope="entity.custom.explode",
            in_extractor=True,
        )
    for key in EXTRACTOR_EXT_DICT_KEYS:
        _ensure(
            fields,
            field_id=f"entity.extension_dictionary.{key}",
            verbatim=key,
            json_path=f"entities.jsonl / extension_dictionary.{key}",
            source_file="entities.jsonl",
            scope="entity.extension_dictionary",
            in_extractor=True,
        )
    for key in EXTRACTOR_DICT_TOP_KEYS:
        _ensure(
            fields,
            field_id=f"dict.{key}",
            verbatim=key,
            json_path=f"dictionaries.jsonl / {key}",
            source_file="dictionaries.jsonl",
            scope="dictionary",
            in_extractor=True,
        )
    for key in EXTRACTOR_DICT_OBJECT_KEYS:
        _ensure(
            fields,
            field_id=f"dict.object.{key}",
            verbatim=key,
            json_path=f"dictionaries.jsonl / object.{key}",
            source_file="dictionaries.jsonl",
            scope="dictionary.object",
            in_extractor=True,
        )
    for key in EXTRACTOR_SEMANTIC_TOP:
        _ensure(
            fields,
            field_id=f"semantic.{key}",
            verbatim=key,
            json_path=f"semantic-objects.json / {key}",
            source_file="semantic-objects.json",
            scope="semantic",
            in_extractor=True,
        )
    for prefix, keys in (
        ("semantic.title", EXTRACTOR_SEMANTIC_BLOCK_KEYS),
        ("semantic.bom", EXTRACTOR_SEMANTIC_BLOCK_KEYS),
        ("semantic.pc", EXTRACTOR_SEMANTIC_BLOCK_KEYS),
        ("semantic.prof", EXTRACTOR_PROF_KEYS),
    ):
        for key in keys:
            _ensure(
                fields,
                field_id=f"{prefix}.{key}",
                verbatim=key,
                json_path=f"semantic-objects.json / {prefix.split('.', 1)[1]}[].{key}",
                source_file="semantic-objects.json",
                scope=prefix,
                in_extractor=True,
            )
    for key in EXTRACTOR_LINK_TOP:
        _ensure(
            fields,
            field_id=f"link.{key}",
            verbatim=key,
            json_path=f"xuhao-bom-links.json / {key}",
            source_file="xuhao-bom-links.json",
            scope="link",
            in_extractor=False,  # derived file, not DrawingExtractor.Extract
        )
        fields[f"link.{key}"].notes.append(
            "xuhao-bom-links.json 是派生产物，DrawingExtractor.Extract 并不写这个文件；现行七张里只有试点图 5TBC.384.A110050.2_1 带这份文件。"
        )
    for key in EXTRACTOR_LINK_ITEM:
        _ensure(
            fields,
            field_id=f"link.item.{key}",
            verbatim=key,
            json_path=f"xuhao-bom-links.json / links[].{key}",
            source_file="xuhao-bom-links.json",
            scope="link.item",
            in_extractor=False,
        )
    for key in EXTRACTOR_ERROR_KEYS:
        _ensure(
            fields,
            field_id=f"error.{key}",
            verbatim=key,
            json_path=f"errors.jsonl / {key}",
            source_file="errors.jsonl",
            scope="error",
            in_extractor=True,
        )

    # --- walk drawings ---
    for dpath in drawings:
        name = dpath.name
        drawing = load_json(dpath / "drawing.json")
        for key, val in drawing.items():
            fid = f"drawing.{key}"
            f = fields.get(fid) or _ensure(
                fields,
                field_id=fid,
                verbatim=key,
                json_path=f"drawing.json / {key}",
                source_file="drawing.json",
                scope="drawing",
            )
            f.add_example(name, "drawing.json", val, empty=_is_empty(val))

        report = load_json(dpath / "extraction-report.json")
        for key, val in report.items():
            fid = f"report.{key}"
            f = fields.get(fid) or _ensure(
                fields,
                field_id=fid,
                verbatim=key,
                json_path=f"extraction-report.json / {key}",
                source_file="extraction-report.json",
                scope="report",
            )
            f.add_example(name, "extraction-report.json", val, empty=_is_empty(val))
        host = report.get("host") or {}
        if isinstance(host, dict):
            for key, val in host.items():
                fid = f"report.host.{key}"
                f = fields.get(fid) or _ensure(
                    fields,
                    field_id=fid,
                    verbatim=key,
                    json_path=f"extraction-report.json / host.{key}",
                    source_file="extraction-report.json",
                    scope="report.host",
                )
                f.add_example(name, "host", val, empty=_is_empty(val))

        tables = load_json(dpath / "tables.json")
        for table, cols in TABLE_COLUMNS.items():
            section = TABLE_JSON_SECTION[table]
            rows = tables.get(section) or []
            for row in rows:
                if not isinstance(row, dict):
                    continue
                loc = f"{table}:{row.get('name') or row.get('handle')}"
                for col, val in row.items():
                    fid = f"{table}.{col}"
                    f = fields.get(fid) or _ensure(
                        fields,
                        field_id=fid,
                        verbatim=col,
                        json_path=f"tables.json / {section}[].{col}",
                        source_file="tables.json",
                        scope=table,
                    )
                    f.add_example(name, loc, val, empty=_is_empty(val))

        so = load_json(dpath / "semantic-objects.json")
        for key, val in so.items():
            fid = f"semantic.{key}"
            f = fields.get(fid) or _ensure(
                fields,
                field_id=fid,
                verbatim=key,
                json_path=f"semantic-objects.json / {key}",
                source_file="semantic-objects.json",
                scope="semantic",
            )
            preview = val if not isinstance(val, list) else f"list[{len(val)}]"
            f.add_example(name, "semantic-objects.json", preview, empty=_is_empty(val))

        for rec in so.get("title_blocks") or []:
            loc = f"title:{rec.get('handle')}"
            for key, val in rec.items():
                fid = f"semantic.title.{key}"
                f = fields.get(fid)
                if f:
                    f.add_example(name, loc, val if key != "fields" else list((val or {}).keys()), empty=_is_empty(val))
            for tag, val in (rec.get("fields") or {}).items():
                fid = f"title.{tag}"
                f = _ensure(
                    fields,
                    field_id=fid,
                    verbatim=tag,
                    json_path=f"semantic-objects.json / title_blocks[].fields.{tag}",
                    source_file="semantic-objects.json",
                    scope="title.fields",
                    in_extractor=True,
                )
                f.add_example(name, loc, val, empty=_is_empty(val))

        for rec in so.get("bom_rows") or []:
            loc = f"bom:{rec.get('handle')}"
            for key, val in rec.items():
                fid = f"semantic.bom.{key}"
                f = fields.get(fid)
                if f:
                    f.add_example(name, loc, val if key != "fields" else list((val or {}).keys()), empty=_is_empty(val))
            for tag, val in (rec.get("fields") or {}).items():
                fid = f"bom.{tag}"
                f = _ensure(
                    fields,
                    field_id=fid,
                    verbatim=tag,
                    json_path=f"semantic-objects.json / bom_rows[].fields.{tag}",
                    source_file="semantic-objects.json",
                    scope="bom.fields",
                    in_extractor=True,
                )
                f.add_example(name, loc, val, empty=_is_empty(val))

        for rec in so.get("other_pc_blocks") or []:
            loc = f"pc:{rec.get('block_name')}:{rec.get('handle')}"
            for key, val in rec.items():
                fid = f"semantic.pc.{key}"
                f = fields.get(fid)
                if f:
                    f.add_example(name, loc, val if key != "fields" else list((val or {}).keys()), empty=_is_empty(val))
            bn = rec.get("block_name") or "UNKNOWN_PC"
            for tag, val in (rec.get("fields") or {}).items():
                fid = f"pc.{bn}.{tag}"
                f = _ensure(
                    fields,
                    field_id=fid,
                    verbatim=tag,
                    json_path=f"semantic-objects.json / other_pc_blocks[{bn}].fields.{tag}",
                    source_file="semantic-objects.json",
                    scope=f"pc.{bn}",
                    in_extractor=True,
                )
                f.add_example(name, loc, val, empty=_is_empty(val))

        for rec in so.get("professional_entities") or []:
            loc = f"prof:{rec.get('runtime_class')}:{rec.get('handle')}"
            for key, val in rec.items():
                fid = f"semantic.prof.{key}"
                f = fields.get(fid)
                if f:
                    preview = val
                    if key in ("custom", "xdata", "bbox") and isinstance(val, dict):
                        preview = list(val.keys())
                    f.add_example(name, loc, preview, empty=_is_empty(val))

        links_path = dpath / "xuhao-bom-links.json"
        if links_path.exists():
            lj = load_json(links_path)
            for key, val in lj.items():
                fid = f"link.{key}"
                f = fields.get(fid) or _ensure(
                    fields,
                    field_id=fid,
                    verbatim=key,
                    json_path=f"xuhao-bom-links.json / {key}",
                    source_file="xuhao-bom-links.json",
                    scope="link",
                )
                preview = val if not isinstance(val, list) else f"list[{len(val)}]"
                f.add_example(name, "xuhao-bom-links.json", preview, empty=_is_empty(val))
            for rec in lj.get("links") or []:
                loc = f"link:seq={rec.get('seq')}"
                for key, val in rec.items():
                    fid = f"link.item.{key}"
                    f = fields.get(fid) or _ensure(
                        fields,
                        field_id=fid,
                        verbatim=key,
                        json_path=f"xuhao-bom-links.json / links[].{key}",
                        source_file="xuhao-bom-links.json",
                        scope="link.item",
                    )
                    f.add_example(name, loc, val, empty=_is_empty(val))

        for rec in iter_jsonl(dpath / "dictionaries.jsonl") or []:
            for key, val in rec.items():
                fid = f"dict.{key}"
                f = fields.get(fid)
                if f:
                    f.add_example(name, "dictionaries.jsonl", val if key != "object" else list((val or {}).keys()), empty=_is_empty(val))
            dkey = rec.get("key")
            if dkey:
                fid = f"dict_key.{dkey}"
                f = _ensure(
                    fields,
                    field_id=fid,
                    verbatim=dkey,
                    json_path=f"dictionaries.jsonl / key={dkey}",
                    source_file="dictionaries.jsonl",
                    scope="named_dictionary",
                    in_extractor=True,
                )
                obj = rec.get("object") or {}
                preview = {
                    "runtime_class": obj.get("runtime_class") or obj.get("kind"),
                    "handle": obj.get("handle"),
                    "count": obj.get("count"),
                    "kind": obj.get("kind"),
                }
                f.add_example(name, f"NOD:{dkey}", preview, empty=_is_empty(obj))
            obj = rec.get("object")
            if isinstance(obj, dict):
                for key, val in obj.items():
                    fid = f"dict.object.{key}"
                    f = fields.get(fid) or _ensure(
                        fields,
                        field_id=fid,
                        verbatim=key,
                        json_path=f"dictionaries.jsonl / object.{key}",
                        source_file="dictionaries.jsonl",
                        scope="dictionary.object",
                    )
                    preview = val
                    if key == "items" and isinstance(val, dict):
                        preview = f"keys={list(val.keys())[:8]}"
                    f.add_example(name, f"NOD:{dkey}", preview, empty=_is_empty(val))

        err_path = dpath / "errors.jsonl"
        if err_path.exists() and err_path.stat().st_size == 0:
            fields["error.handle"].notes.append(f"{name}: errors.jsonl 空文件（0 字节）")
        for rec in iter_jsonl(err_path) or []:
            loc = f"error:{rec.get('handle')}"
            for key, val in rec.items():
                fid = f"error.{key}"
                f = fields.get(fid) or _ensure(
                    fields,
                    field_id=fid,
                    verbatim=key,
                    json_path=f"errors.jsonl / {key}",
                    source_file="errors.jsonl",
                    scope="error",
                )
                f.add_example(name, loc, val, empty=_is_empty(val))

        proxy_path = dpath / "proxies.jsonl"
        if proxy_path.exists() and proxy_path.stat().st_size == 0:
            fields["entity.proxy"].notes.append(f"{name}: proxies.jsonl 空文件（0 字节）")
        for rec in iter_jsonl(proxy_path) or []:
            loc = f"proxy:{rec.get('handle')}"
            pr = rec.get("proxy")
            if isinstance(pr, dict):
                for key, val in pr.items():
                    fid = f"entity.proxy.{key}"
                    f = fields.get(fid)
                    if f:
                        f.add_example(name, loc, val, empty=_is_empty(val))

        for rec in iter_jsonl(dpath / "entities.jsonl"):
            loc = f"h={rec.get('handle')} {rec.get('runtime_class')}"
            for key, val in rec.items():
                fid = f"entity.{key}"
                f = fields.get(fid)
                if f:
                    preview = val
                    if key in ("geometry", "color", "bbox", "xdata", "custom", "attributes", "extension_dictionary") and isinstance(val, (dict, list)):
                        if isinstance(val, dict):
                            preview = list(val.keys())
                        else:
                            preview = f"list[{len(val)}]"
                    f.add_example(name, loc, preview, empty=_is_empty(val))

            color = rec.get("color")
            if isinstance(color, dict):
                for key, val in color.items():
                    fid = f"entity.color.{key}"
                    f = fields.get(fid) or _ensure(
                        fields,
                        field_id=fid,
                        verbatim=key,
                        json_path=f"entities.jsonl / color.{key}",
                        source_file="entities.jsonl",
                        scope="entity.color",
                    )
                    f.add_example(name, loc, val, empty=_is_empty(val))

            bbox = rec.get("bbox")
            if isinstance(bbox, dict):
                for key, val in bbox.items():
                    fid = f"entity.bbox.{key}"
                    f = fields.get(fid) or _ensure(
                        fields,
                        field_id=fid,
                        verbatim=key,
                        json_path=f"entities.jsonl / bbox.{key}",
                        source_file="entities.jsonl",
                        scope="entity.bbox",
                    )
                    f.add_example(name, loc, val, empty=_is_empty(val))

            geo = rec.get("geometry")
            if isinstance(geo, dict):
                for key, val in geo.items():
                    fid = f"entity.geometry.{key}"
                    f = fields.get(fid) or _ensure(
                        fields,
                        field_id=fid,
                        verbatim=key,
                        json_path=f"entities.jsonl / geometry.{key}",
                        source_file="entities.jsonl",
                        scope="entity.geometry",
                    )
                    f.add_example(name, loc, val, empty=_is_empty(val))

            text = rec.get("text")
            if isinstance(text, dict):
                for key, val in text.items():
                    fid = f"entity.text.{key}"
                    f = fields.get(fid) or _ensure(
                        fields,
                        field_id=fid,
                        verbatim=key,
                        json_path=f"entities.jsonl / text.{key}",
                        source_file="entities.jsonl",
                        scope="entity.text",
                    )
                    f.add_example(name, loc, val, empty=_is_empty(val))
            elif isinstance(text, str):
                fields["entity.text"].counts["string_values"] += 1

            attrs = rec.get("attributes")
            if isinstance(attrs, list):
                for item in attrs:
                    if not isinstance(item, dict):
                        continue
                    for key, val in item.items():
                        fid = f"entity.attributes.{key}"
                        f = fields.get(fid) or _ensure(
                            fields,
                            field_id=fid,
                            verbatim=key,
                            json_path=f"entities.jsonl / attributes[].{key}",
                            source_file="entities.jsonl",
                            scope="entity.attributes",
                        )
                        f.add_example(name, loc, val, empty=_is_empty(val))

            xdata = rec.get("xdata")
            if isinstance(xdata, dict):
                for app, vals in xdata.items():
                    fid = f"entity.xdata.{app}"
                    f = _ensure(
                        fields,
                        field_id=fid,
                        verbatim=app,
                        json_path=f"entities.jsonl / xdata.{app}",
                        source_file="entities.jsonl",
                        scope="entity.xdata",
                        in_extractor=True,
                    )
                    f.add_example(name, loc, vals, empty=_is_empty(vals))

            ext = rec.get("extension_dictionary")
            if isinstance(ext, dict):
                for key, val in ext.items():
                    fid = f"entity.extension_dictionary.{key}"
                    f = fields.get(fid) or _ensure(
                        fields,
                        field_id=fid,
                        verbatim=key,
                        json_path=f"entities.jsonl / extension_dictionary.{key}",
                        source_file="entities.jsonl",
                        scope="entity.extension_dictionary",
                    )
                    preview = val
                    if key == "items" and isinstance(val, dict):
                        preview = f"keys={list(val.keys())[:8]}"
                    f.add_example(name, loc, preview, empty=_is_empty(val))

            custom = rec.get("custom")
            if isinstance(custom, dict):
                for key, val in custom.items():
                    fid = f"entity.custom.{key}"
                    f = fields.get(fid) or _ensure(
                        fields,
                        field_id=fid,
                        verbatim=key,
                        json_path=f"entities.jsonl / custom.{key}",
                        source_file="entities.jsonl",
                        scope="entity.custom",
                    )
                    preview = val
                    if key == "properties" and isinstance(val, dict):
                        preview = f"prop_keys={list(val.keys())[:10]}"
                    elif key == "explode" and isinstance(val, list):
                        preview = f"explode[{len(val)}]"
                    f.add_example(name, loc, preview, empty=_is_empty(val))
                props = custom.get("properties")
                if isinstance(props, dict):
                    for pkey, pval in props.items():
                        fid = f"entity.custom.properties.{pkey}"
                        f = _ensure(
                            fields,
                            field_id=fid,
                            verbatim=pkey,
                            json_path=f"entities.jsonl / custom.properties.{pkey}",
                            source_file="entities.jsonl",
                            scope="entity.custom.properties",
                            in_extractor=True,
                        )
                        f.add_example(name, loc, pval, empty=_is_empty(pval))
                explode = custom.get("explode")
                if isinstance(explode, list):
                    for part in explode:
                        if not isinstance(part, dict):
                            continue
                        for key, val in part.items():
                            fid = f"entity.custom.explode.{key}"
                            f = fields.get(fid) or _ensure(
                                fields,
                                field_id=fid,
                                verbatim=key,
                                json_path=f"entities.jsonl / custom.explode[].{key}",
                                source_file="entities.jsonl",
                                scope="entity.custom.explode",
                            )
                            f.add_example(name, loc, val, empty=_is_empty(val))

            proxy = rec.get("proxy")
            if isinstance(proxy, dict):
                for key, val in proxy.items():
                    fid = f"entity.proxy.{key}"
                    f = fields.get(fid)
                    if f:
                        f.add_example(name, loc, val, empty=_is_empty(val))

    # PC_CSL_BLOCK has no model-space insert; still register a marker field.
    if "pc.PC_CSL_BLOCK" not in fields:
        f = _ensure(
            fields,
            field_id="pc.PC_CSL_BLOCK",
            verbatim="PC_CSL_BLOCK",
            json_path="semantic-objects.json / other_pc_blocks[PC_CSL_BLOCK] (no instance) + tables.json blocks",
            source_file="semantic-objects.json",
            scope="pc.PC_CSL_BLOCK",
            in_extractor=True,
        )
        f.notes.append(
            "七张图的块表都有 PC_CSL_BLOCK 定义，但模型空间无插入实例，other_pc_blocks 无此块；属性 tag 因 AttributeDefinition 被当成 DBText 抽成 geometry.kind=text 且 text 为空串，本抽取拿不到参数栏格子名。"
        )

    # Confirm extractor source is the map we used.
    if EXTRACTOR_CS.exists():
        src = EXTRACTOR_CS.read_text(encoding="utf-8")
        for token in ("semantic_type", "tile_mode", "source_sha256", "GeometryOf", "TextOf"):
            if token not in src:
                raise RuntimeError(f"extractor map missing expected token {token}")

    ordered = {fid: fields[fid].as_dict() for fid in sorted(fields)}
    return ordered


def write_inventory_txt(inv: dict[str, dict], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = [fid for fid in inv]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def field_filename(field_id: str) -> str:
    """Windows-safe filename for a field id. Chinese tags stay Chinese."""
    slug = field_id
    for a, b in (
        ("*", "_STAR_"),
        ("?", "_Q_"),
        (":", "_"),
        ("<", "_"),
        (">", "_"),
        ("|", "_"),
        ('"', "_"),
        ("/", "_"),
        ("\\", "_"),
    ):
        slug = slug.replace(a, b)
    return slug + ".md"
