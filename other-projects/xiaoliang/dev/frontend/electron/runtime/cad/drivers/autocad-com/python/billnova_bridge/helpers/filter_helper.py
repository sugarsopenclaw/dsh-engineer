"""实体过滤：图层 / 类型（glob 风格）"""

import fnmatch
from typing import Any, Dict, Iterable, List, Optional, Set


def _norm_type(t: str) -> str:
    return (t or "").strip().lower().replace(" ", "_")


def entity_type_matches(serialized: Dict[str, Any], wanted: Set[str]) -> bool:
    """serialized 为 entity_serializer 输出"""
    if not wanted:
        return True
    et = _norm_type(str(serialized.get("type", "")))
    dim_type = _norm_type(str(serialized.get("dim_type", "")))
    candidates = {et}
    if dim_type:
        candidates.add(dim_type)
    if et == "dimension":
        candidates.add("dimension")
    if et in ("lwpolyline", "2d_polyline", "3d_polyline") or "polyline" in et:
        candidates.add("polyline")
    if et == "block_reference":
        candidates.add("block_reference")
    for w in wanted:
        ww = _norm_type(w)
        if ww in candidates:
            return True
        if fnmatch.fnmatch(et, ww):
            return True
    return False


def layer_matches(layer_name: str, patterns: Optional[List[str]]) -> bool:
    if not patterns:
        return True
    for pat in patterns:
        if fnmatch.fnmatchcase(layer_name, pat) or fnmatch.fnmatchcase(layer_name, pat.upper()):
            return True
        if fnmatch.fnmatch(layer_name, pat):
            return True
    return False


def filter_serialized_entities(
    entities: Iterable[Dict[str, Any]],
    layers: Optional[List[str]] = None,
    types: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    wanted_types = {_norm_type(t) for t in (types or []) if t}
    out: List[Dict[str, Any]] = []
    for e in entities:
        if layers and not layer_matches(str(e.get("layer", "")), layers):
            continue
        if types and not entity_type_matches(e, wanted_types):
            continue
        out.append(e)
    return out
