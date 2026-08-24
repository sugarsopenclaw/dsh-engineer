"""read_by_filter 高级过滤（规范 filter 语法：and / or / 子句）"""

from __future__ import annotations

import fnmatch
from typing import Any, Dict, List, Optional, Set, Union

from helpers.filter_helper import entity_type_matches, layer_matches, _norm_type

FilterSpec = Union[Dict[str, Any], List[Any]]


def _clause_type(e: Dict[str, Any], wanted: List[str]) -> bool:
    st = {_norm_type(t) for t in wanted}
    return entity_type_matches(e, st)


def _clause_layer(e: Dict[str, Any], patterns: List[str]) -> bool:
    return layer_matches(str(e.get("layer", "")), patterns)


def _num(v: Any) -> Optional[float]:
    try:
        return float(v)
    except Exception:
        return None


def _match_clause(e: Dict[str, Any], clause: Dict[str, Any]) -> bool:
    if "type" in clause:
        if not _clause_type(e, list(clause["type"] or [])):
            return False
    if "layer" in clause:
        if not _clause_layer(e, list(clause["layer"] or [])):
            return False
    if "closed" in clause:
        want = bool(clause["closed"])
        if bool(e.get("closed")) != want:
            return False
    if "area_gt" in clause:
        a = _num(e.get("area"))
        if a is None or a <= float(clause["area_gt"]):
            return False
    if "area_lt" in clause:
        a = _num(e.get("area"))
        if a is None or a >= float(clause["area_lt"]):
            return False
    if "length_gt" in clause:
        ln = _num(e.get("length"))
        if ln is None or ln <= float(clause["length_gt"]):
            return False
    if "length_lt" in clause:
        ln = _num(e.get("length"))
        if ln is None or ln >= float(clause["length_lt"]):
            return False
    return True


def evaluate_filter_spec(e: Dict[str, Any], spec: Dict[str, Any]) -> bool:
    if not spec:
        return True
    if "and" in spec:
        for x in spec["and"] or []:
            if not isinstance(x, dict):
                return False
            if not evaluate_filter_spec(e, x):
                return False
        return True
    if "or" in spec:
        parts = [x for x in (spec["or"] or []) if isinstance(x, dict)]
        if not parts:
            return False
        return any(evaluate_filter_spec(e, x) for x in parts)
    if "not" in spec:
        inner = spec["not"]
        if isinstance(inner, dict):
            return not evaluate_filter_spec(e, inner)
        return True
    return _match_clause(e, spec)


def filter_spec_from_param(f: Any) -> Dict[str, Any]:
    if isinstance(f, dict):
        return f
    return {}
