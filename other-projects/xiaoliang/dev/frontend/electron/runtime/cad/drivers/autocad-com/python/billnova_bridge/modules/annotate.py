"""annotate.* RPC"""

import fnmatch
import pythoncom
import re
from typing import Any, Dict, List

from entity_serializer import serialize_entity
from helpers.entity_cache import EntityCache
from helpers.filter_helper import layer_matches
from helpers.modelspace import iter_modelspace
from helpers.selection_set import get_selection_set
from helpers.variant import make_point, round_point
from mtext_cleaner import clean_mtext
from win32com.client import VARIANT


def _active_doc(acad):
    doc = acad.ActiveDocument
    if doc is None:
        raise RuntimeError("no active document")
    return doc


def _layer_ok(layer_name: str, layers) -> bool:
    if not layers:
        return True
    return layer_name in layers


def rpc_annotate_read_all_text(acad, params) -> Dict[str, Any]:
    params = params or {}
    layers = params.get("layers")
    clean_default = params.get("clean")
    clean = True if clean_default is None else bool(clean_default)
    doc = _active_doc(acad)
    items: List[Dict[str, Any]] = []
    for ent in iter_modelspace(doc):
        try:
            on = str(ent.ObjectName)
            if on not in ("AcDbText", "AcDbMText"):
                continue
            ser = serialize_entity(ent)
            if layers and not _layer_ok(str(ser.get("layer", "")), layers):
                continue
            if not clean and on == "AcDbMText":
                ser = dict(ser)
                raw = str(ser.get("content", ""))
                ser["content_clean"] = raw
            items.append(ser)
        except Exception:
            continue
    return {"items": items, "count": len(items)}


def rpc_annotate_read_all_dims(acad, params) -> Dict[str, Any]:
    params = params or {}
    layers = params.get("layers")
    doc = _active_doc(acad)
    items: List[Dict[str, Any]] = []
    for ent in iter_modelspace(doc):
        try:
            on = str(ent.ObjectName)
            if "Dimension" not in on:
                continue
            ser = serialize_entity(ent)
            if ser.get("type") != "dimension":
                continue
            if layers and not _layer_ok(str(ser.get("layer", "")), layers):
                continue
            items.append(ser)
        except Exception:
            continue
    return {"items": items, "count": len(items)}


def rpc_annotate_read_all_tables(acad, params) -> Dict[str, Any]:
    params = params or {}
    layers = params.get("layers")
    doc = _active_doc(acad)
    items: List[Dict[str, Any]] = []
    for ent in iter_modelspace(doc):
        try:
            on = str(ent.ObjectName)
            if on != "AcDbTable":
                continue
            ser = serialize_entity(ent)
            if layers and not _layer_ok(str(ser.get("layer", "")), layers):
                continue
            items.append(ser)
        except Exception:
            continue
    return {"items": items, "count": len(items)}


def rpc_annotate_find_text(acad, params) -> Dict[str, Any]:
    params = params or {}
    pattern = str(params.get("pattern", ""))
    use_regex = bool(params.get("regex"))
    lim = params.get("limit")
    max_matches = int(lim) if lim is not None else None
    if max_matches is not None and max_matches < 0:
        max_matches = None
    mscan = params.get("max_entities_scanned")
    scan_cap = int(mscan) if mscan is not None else None
    if scan_cap is not None and scan_cap < 0:
        scan_cap = None
    doc = _active_doc(acad)
    matches: List[Dict[str, Any]] = []
    scanned = 0
    for ent in iter_modelspace(doc):
        scanned += 1
        if scan_cap is not None and scanned > scan_cap:
            break
        try:
            on = str(ent.ObjectName)
            if on not in ("AcDbText", "AcDbMText"):
                continue
            ser = serialize_entity(ent)
            cc = str(ser.get("content_clean") or ser.get("content") or "")
            ok = False
            if use_regex:
                ok = re.search(pattern, cc) is not None
            else:
                ok = fnmatch.fnmatch(cc, pattern) or (pattern in cc)
            if ok:
                matches.append(
                    {
                        "handle": ser.get("handle"),
                        "layer": ser.get("layer"),
                        "content_clean": cc,
                        "entity": ser,
                    }
                )
                if max_matches is not None and len(matches) >= max_matches:
                    break
        except Exception:
            continue
    return {"matches": matches, "count": len(matches)}


def _safe_bbox(ent):
    try:
        mn, mx = ent.GetBoundingBox()
        return {"min": round_point(mn), "max": round_point(mx)}
    except Exception:
        return None


def _safe_text(value: Any) -> str:
    if value is None:
        return ""
    try:
        return clean_mtext(str(value))
    except Exception:
        return str(value)


def _normalize_text(value: str) -> str:
    return re.sub(r"\s+", "", value).lower()


def _match_text(content: str, pattern: str, use_regex: bool, case_sensitive: bool, normalized: bool) -> bool:
    if not content:
        return False
    target = content if case_sensitive else content.lower()
    needle = pattern if case_sensitive else pattern.lower()
    if use_regex:
        flags = 0 if case_sensitive else re.IGNORECASE
        try:
            return re.search(pattern, content, flags) is not None
        except Exception:
            return False
    if fnmatch.fnmatch(target, needle) or needle in target:
        return True
    if normalized:
        return _normalize_text(pattern) in _normalize_text(content)
    return False


def _representative_point(ser: Dict[str, Any]):
    for key in ("position", "text_position", "insert_point", "center", "point1", "point2"):
        value = ser.get(key)
        if isinstance(value, list) and len(value) >= 2:
            try:
                return [float(value[0]), float(value[1])]
            except Exception:
                pass
    bbox = ser.get("bbox")
    if isinstance(bbox, dict) and isinstance(bbox.get("min"), list) and isinstance(bbox.get("max"), list):
        mn = bbox["min"]
        mx = bbox["max"]
        if len(mn) >= 2 and len(mx) >= 2:
            try:
                return [round((float(mn[0]) + float(mx[0])) / 2, 2), round((float(mn[1]) + float(mx[1])) / 2, 2)]
            except Exception:
                pass
    return None


def _entity_bbox_or_point_window(ser: Dict[str, Any]):
    bbox = ser.get("bbox")
    if isinstance(bbox, dict) and isinstance(bbox.get("min"), list) and isinstance(bbox.get("max"), list):
        return bbox
    point = _representative_point(ser)
    if point:
        return {"min": [point[0], point[1]], "max": [point[0], point[1]]}
    return None


def _score_match(source: str, content: str, pattern: str, query_terms: List[str]) -> float:
    score = 1.0
    lower = content.lower()
    normalized_content = _normalize_text(content)
    normalized_pattern = _normalize_text(pattern)
    if normalized_pattern and normalized_pattern in normalized_content:
        score += 4.0
    for term in query_terms:
        if _normalize_text(term) in normalized_content:
            score += 1.25
    if source in ("text", "mtext", "table_cell", "block_attribute"):
        score += 1.0
    if source in ("dimension", "mleader"):
        score += 0.75
    if len(content) <= 80:
        score += 0.25
    return round(score, 4)


def _make_match(
    ent,
    ser: Dict[str, Any],
    source: str,
    content: str,
    pattern: str,
    query_terms: List[str],
    sub_path: str = "",
    label: str = "",
):
    bbox = _entity_bbox_or_point_window(ser)
    return {
        "handle": ser.get("handle"),
        "layer": ser.get("layer"),
        "object_name": str(getattr(ent, "ObjectName", "")),
        "source": source,
        "sub_path": sub_path,
        "label": label,
        "content_clean": _safe_text(content),
        "bbox": bbox,
        "point": _representative_point(ser),
        "score": _score_match(source, content, pattern, query_terms),
        "entity": ser,
    }


def _iter_searchable_candidates(ent, ser: Dict[str, Any]):
    on = str(getattr(ent, "ObjectName", ""))
    typ = str(ser.get("type", ""))
    if on == "AcDbText":
        yield "text", str(ser.get("content_clean") or ser.get("content") or ""), "", ""
    elif on == "AcDbMText":
        yield "mtext", str(ser.get("content_clean") or ser.get("content") or ""), "", ""
    elif "Dimension" in on or typ == "dimension":
        override = _safe_text(ser.get("text_override"))
        measurement = ser.get("measurement")
        if override:
            yield "dimension", override, "text_override", "标注文字"
        if measurement is not None and not (override and "<>" not in override):
            yield "dimension", str(measurement), "measurement", "标注测量值"
    elif on == "AcDbMLeader" or typ == "mleader":
        yield "mleader", str(ser.get("text_content") or ser.get("content_clean") or ""), "", "多重引线文字"
    elif on == "AcDbTable" or typ == "table":
        cells = ser.get("cells")
        if isinstance(cells, list):
            for r, row in enumerate(cells):
                if not isinstance(row, list):
                    continue
                row_text = " | ".join(_safe_text(cell) for cell in row if _safe_text(cell))
                if row_text:
                    yield "table_row", row_text, f"row={r}", f"表格第 {r + 1} 行"
                for c, cell in enumerate(row):
                    text = _safe_text(cell)
                    if text:
                        yield "table_cell", text, f"row={r};col={c}", f"表格 R{r + 1}C{c + 1}"
    elif on == "AcDbBlockReference" or typ == "block_reference":
        name = _safe_text(ser.get("name"))
        if name:
            yield "block_name", name, "name", "块名"
        attrs = ser.get("attributes")
        if isinstance(attrs, dict):
            for tag, value in attrs.items():
                text = _safe_text(value)
                if text:
                    yield "block_attribute", f"{tag}={text}", f"attribute={tag}", f"块属性 {tag}"


def _iter_searchable_candidates_fast(ent):
    on = str(getattr(ent, "ObjectName", ""))
    if on == "AcDbText":
        try:
            yield "text", _safe_text(ent.TextString), "", "", None
        except Exception:
            return
    elif on == "AcDbMText":
        try:
            yield "mtext", _safe_text(ent.TextString), "", "", None
        except Exception:
            return
    elif "Dimension" in on:
        override = ""
        measurement = None
        try:
            override = _safe_text(ent.TextOverride)
        except Exception:
            pass
        try:
            measurement = ent.Measurement
        except Exception:
            pass
        if override:
            yield "dimension", override, "text_override", "标注文字", None
        if measurement is not None and not (override and "<>" not in override):
            yield "dimension", str(round(float(measurement), 4)), "measurement", "标注测量值", None
    elif on == "AcDbMLeader":
        text_content = ""
        for attr in ("TextString", "MTextText", "Contents", "Content"):
            try:
                text_content = _safe_text(getattr(ent, attr))
                if text_content:
                    break
            except Exception:
                continue
        if text_content:
            yield "mleader", text_content, "", "多重引线文字", None
    elif on == "AcDbTable":
        ser = serialize_entity(ent)
        cells = ser.get("cells")
        if isinstance(cells, list):
            for r, row in enumerate(cells):
                if not isinstance(row, list):
                    continue
                cleaned_row = [_safe_text(cell) for cell in row]
                row_text = " | ".join(cell for cell in cleaned_row if cell)
                if row_text:
                    yield "table_row", row_text, f"row={r}", f"表格第 {r + 1} 行", ser
                for c, text in enumerate(cleaned_row):
                    if text:
                        yield "table_cell", text, f"row={r};col={c}", f"表格 R{r + 1}C{c + 1}", ser
    elif on == "AcDbBlockReference":
        name = ""
        try:
            name = _safe_text(ent.Name)
        except Exception:
            pass
        if name:
            yield "block_name", name, "name", "块名", None
        try:
            attrs = ent.GetAttributes()
            for i in range(int(attrs.Count)):
                attr = attrs.Item(i)
                tag = ""
                text = ""
                try:
                    tag = _safe_text(attr.TagString)
                    text = _safe_text(attr.TextString)
                except Exception:
                    continue
                if text:
                    yield "block_attribute", f"{tag}={text}", f"attribute={tag}", f"块属性 {tag}", None
        except Exception:
            pass


def _is_searchable_annotation_object(object_name: str, source_filter) -> bool:
    if source_filter:
        if object_name == "AcDbText":
            return "text" in source_filter
        if object_name == "AcDbMText":
            return "mtext" in source_filter
        if "Dimension" in object_name:
            return "dimension" in source_filter
        if object_name == "AcDbMLeader":
            return "mleader" in source_filter
        if object_name == "AcDbTable":
            return "table" in source_filter or "table_row" in source_filter or "table_cell" in source_filter
        if object_name == "AcDbBlockReference":
            return "block_name" in source_filter or "block_attribute" in source_filter
        return False
    return (
        object_name in ("AcDbText", "AcDbMText", "AcDbMLeader", "AcDbTable", "AcDbBlockReference")
        or "Dimension" in object_name
    )


def _dxf_names_for_source_filter(source_filter) -> List[str]:
    if not source_filter:
        return ["TEXT", "MTEXT", "DIMENSION", "INSERT", "ACAD_TABLE", "MULTILEADER"]
    names: List[str] = []
    if "text" in source_filter:
        names.append("TEXT")
    if "mtext" in source_filter:
        names.append("MTEXT")
    if "dimension" in source_filter:
        names.append("DIMENSION")
    if "mleader" in source_filter:
        names.append("MULTILEADER")
    if "table" in source_filter or "table_row" in source_filter or "table_cell" in source_filter:
        names.append("ACAD_TABLE")
    if "block_name" in source_filter or "block_attribute" in source_filter:
        names.append("INSERT")
    return names


def _iter_annotation_candidates(doc, source_filter):
    dxf_names = _dxf_names_for_source_filter(source_filter)
    if not dxf_names:
        return
    ss = get_selection_set(doc, "BN_FIND_PLUS")
    try:
        ft = VARIANT(pythoncom.VT_ARRAY | pythoncom.VT_I2, (0,))
        fd = VARIANT(
            pythoncom.VT_ARRAY | pythoncom.VT_VARIANT,
            (VARIANT(pythoncom.VT_BSTR, ",".join(dxf_names)),),
        )
        try:
            ss.Select(5, None, None, ft, fd)
        except Exception:
            emin = doc.GetVariable("EXTMIN")
            emax = doc.GetVariable("EXTMAX")
            p1 = make_point(float(emin[0]), float(emin[1]))
            p2 = make_point(float(emax[0]), float(emax[1]))
            ss.Select(1, p1, p2, ft, fd)
        for i in range(int(ss.Count)):
            yield ss.Item(i)
    except Exception:
        for ent in iter_modelspace(doc):
            try:
                on = str(getattr(ent, "ObjectName", ""))
                if _is_searchable_annotation_object(on, source_filter):
                    yield ent
            except Exception:
                continue
    finally:
        try:
            ss.Delete()
        except Exception:
            pass


def rpc_annotate_find_text_plus(acad, params) -> Dict[str, Any]:
    params = params or {}
    pattern = str(params.get("pattern", ""))
    use_regex = bool(params.get("regex"))
    case_sensitive = bool(params.get("case_sensitive"))
    normalized = params.get("normalized")
    normalized_match = True if normalized is None else bool(normalized)
    lim = params.get("limit")
    max_matches = int(lim) if lim is not None else 80
    if max_matches <= 0:
        max_matches = 80
    scan_all_matches = bool(params.get("scan_all_matches"))
    mscan = params.get("max_entities_scanned")
    scan_cap = int(mscan) if mscan is not None else None
    if scan_cap is not None and scan_cap < 0:
        scan_cap = None
    include_sources = params.get("sources")
    source_filter = set(str(item).lower() for item in include_sources) if isinstance(include_sources, list) else None
    query_terms = [
        str(item).strip()
        for item in (params.get("keywords") or [])
        if str(item).strip()
    ]
    doc = _active_doc(acad)
    matches: List[Dict[str, Any]] = []
    scanned = 0
    source_counts: Dict[str, int] = {}
    for ent in _iter_annotation_candidates(doc, source_filter):
        scanned += 1
        if scan_cap is not None and scanned > scan_cap:
            break
        try:
            on = str(getattr(ent, "ObjectName", ""))
            if not _is_searchable_annotation_object(on, source_filter):
                continue
            for source, content, sub_path, label, pre_serialized in _iter_searchable_candidates_fast(ent):
                if source_filter and source.lower() not in source_filter:
                    continue
                source_counts[source] = source_counts.get(source, 0) + 1
                if not _match_text(content, pattern, use_regex, case_sensitive, normalized_match):
                    continue
                ser = pre_serialized or serialize_entity(ent)
                if not ser.get("bbox"):
                    bbox = _safe_bbox(ent)
                    if bbox:
                        ser["bbox"] = bbox
                matches.append(_make_match(ent, ser, source, content, pattern, query_terms, sub_path, label))
                if not scan_all_matches and len(matches) >= max_matches:
                    break
            if not scan_all_matches and len(matches) >= max_matches:
                break
        except Exception:
            continue
    matches.sort(key=lambda item: (-float(item.get("score") or 0), str(item.get("source") or ""), str(item.get("handle") or "")))
    if len(matches) > max_matches:
        matches = matches[:max_matches]
    return {
        "matches": matches,
        "count": len(matches),
        "scanned": scanned,
        "source_counts": source_counts,
        "pattern": pattern,
        "regex": use_regex,
        "case_sensitive": case_sensitive,
        "normalized": normalized_match,
        "scan_all_matches": scan_all_matches,
    }


def rpc_annotate_read_all_leaders(acad, params) -> Dict[str, Any]:
    params = params or {}
    layers = params.get("layers")
    doc = _active_doc(acad)
    items: List[Dict[str, Any]] = []
    for ent in iter_modelspace(doc):
        try:
            on = str(ent.ObjectName)
            if on not in ("AcDbLeader", "AcDbMLeader"):
                continue
            ser = serialize_entity(ent)
            if layers and not layer_matches(str(ser.get("layer", "")), layers):
                continue
            items.append(ser)
        except Exception:
            continue
    return {"items": items, "count": len(items)}


def rpc_annotate_create_text(acad, params) -> Dict[str, Any]:
    params = params or {}
    content = str(params.get("content", ""))
    pos = params.get("position") or [0, 0]
    height = float(params.get("height", 2.5))
    layer = params.get("layer")
    doc = _active_doc(acad)
    ms = doc.ModelSpace
    ent = ms.AddMText(make_point(float(pos[0]), float(pos[1])), float(params.get("width", 10.0)), content)
    try:
        ent.Height = height
    except Exception:
        pass
    if layer:
        ent.Layer = str(layer)
    EntityCache.invalidate()
    return {"entity": serialize_entity(ent)}
