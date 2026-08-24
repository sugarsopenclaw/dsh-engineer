"""entity.* RPC"""

from typing import Any, Dict, List, Optional

from entity_serializer import serialize_entity, stats_type_key
from helpers.entity_cache import EntityCache
from helpers.filter_helper import filter_serialized_entities
from helpers.modelspace import iter_modelspace
from helpers.selection_set import get_selection_set
from helpers.variant import make_point, round_point


def _active_doc(acad):
    doc = acad.ActiveDocument
    if doc is None:
        raise RuntimeError("no active document")
    return doc


def _normalize_handle(h: str) -> str:
    s = str(h).strip()
    if s.lower().startswith("0x"):
        s = s[2:]
    return s


def rpc_entity_read_all(acad, params) -> Dict[str, Any]:
    params = params or {}
    doc = _active_doc(acad)
    layers: Optional[List[str]] = params.get("layers")
    types: Optional[List[str]] = params.get("types")
    limit = params.get("limit")
    lim = int(limit) if limit is not None else None

    entities: List[Dict[str, Any]] = []
    for ent in iter_modelspace(doc):
        try:
            ser = serialize_entity(ent)
        except Exception:
            continue
        if not filter_serialized_entities([ser], layers=layers, types=types):
            continue
        entities.append(ser)
        if lim is not None and lim >= 0 and len(entities) >= lim:
            break
    EntityCache.set_from_read_all(doc, entities)
    return {"entities": entities, "count": len(entities)}


def rpc_entity_read_by_handle(acad, params) -> Dict[str, Any]:
    params = params or {}
    handle = params.get("handle")
    if not handle:
        raise ValueError("handle required")
    doc = _active_doc(acad)
    h = _normalize_handle(str(handle))
    obj = doc.HandleToObject(h)
    ent = serialize_entity(obj)
    return {"entity": ent}


def rpc_entity_read_by_handles(acad, params) -> Dict[str, Any]:
    params = params or {}
    handles = params.get("handles") or []
    if not isinstance(handles, list):
        raise ValueError("handles must be array")
    doc = _active_doc(acad)
    ok: List[Dict[str, Any]] = []
    errors: List[Dict[str, Any]] = []
    for h in handles:
        hs = _normalize_handle(str(h))
        try:
            obj = doc.HandleToObject(hs)
            ok.append(serialize_entity(obj))
        except Exception as e:
            errors.append({"handle": str(h), "error": str(e)})
    return {"entities": ok, "errors": errors}


def rpc_entity_read_by_window(acad, params) -> Dict[str, Any]:
    return _read_by_rect(acad, params, mode=0)


def rpc_entity_read_by_crossing(acad, params) -> Dict[str, Any]:
    return _read_by_rect(acad, params, mode=1)


def _read_by_rect(acad, params, mode: int) -> Dict[str, Any]:
    params = params or {}
    mn = params.get("min")
    mx = params.get("max")
    if not mn or not mx:
        raise ValueError("min and max required")
    layers = params.get("layers")
    types = params.get("types")
    doc = _active_doc(acad)
    ss = get_selection_set(doc, "BN_TEMP")
    entities: List[Dict[str, Any]] = []
    try:
        pt1 = make_point(float(mn[0]), float(mn[1]))
        pt2 = make_point(float(mx[0]), float(mx[1]))
        ss.Select(mode, pt1, pt2)
        n = int(ss.Count)
        for i in range(n):
            try:
                ent = ss.Item(i)
                ser = serialize_entity(ent)
                entities.append(ser)
            except Exception:
                continue
    finally:
        try:
            ss.Delete()
        except Exception:
            pass
    filtered = filter_serialized_entities(entities, layers=layers, types=types)
    EntityCache.set_from_read_all(doc, filtered)
    return {"entities": filtered, "count": len(filtered)}


def rpc_entity_count(acad, params) -> Dict[str, Any]:
    params = params or {}
    group_by = str(params.get("group_by", "type")).lower()
    doc = _active_doc(acad)
    groups: Dict[str, int] = {}
    for ent in iter_modelspace(doc):
        try:
            ser = serialize_entity(ent)
        except Exception:
            continue
        if group_by == "layer":
            key = str(ser.get("layer", ""))
        else:
            key = stats_type_key(ser)
        groups[key] = groups.get(key, 0) + 1
    return {"groups": groups}


def rpc_entity_get_extents(acad, params) -> Dict[str, Any]:
    params = params or {}
    handle = params.get("handle")
    if not handle:
        raise ValueError("handle required")
    doc = _active_doc(acad)
    h = _normalize_handle(str(handle))
    obj = doc.HandleToObject(h)
    try:
        mn, mx = obj.GetBoundingBox()
        return {"min": round_point(mn), "max": round_point(mx)}
    except Exception as e:
        raise RuntimeError(f"GetBoundingBox failed: {e}") from e


def rpc_entity_extract_selection(acad, params) -> Dict[str, Any]:
    """读取用户在 CAD 中当前框选的实体（PickfirstSelectionSet）"""
    params = params or {}
    layers = params.get("layers")
    types = params.get("types")
    doc = _active_doc(acad)
    try:
        ss = doc.PickfirstSelectionSet
    except Exception:
        return {"entities": [], "count": 0, "error": "no pickfirst selection available"}
    entities: List[Dict[str, Any]] = []
    n = int(ss.Count)
    for i in range(n):
        try:
            ent = ss.Item(i)
            ser = serialize_entity(ent)
            entities.append(ser)
        except Exception:
            continue
    filtered = filter_serialized_entities(entities, layers=layers, types=types)
    return {"entities": filtered, "count": len(filtered)}


def rpc_entity_select_by_handle(acad, params) -> Dict[str, Any]:
    """通过 Handle 在 CAD 中高亮选中实体（用 LISP sssetfirst）"""
    params = params or {}
    handle = params.get("handle")
    if not handle:
        raise ValueError("handle required")
    doc = _active_doc(acad)
    h = _normalize_handle(str(handle))
    doc.HandleToObject(h)
    lisp_cmd = f'(if (setq e (handent "{h}")) (sssetfirst nil (ssadd e))) '
    doc.SendCommand(lisp_cmd)
    return {"ok": True, "handle": h}


def rpc_entity_clear_selection(acad, _params) -> Dict[str, Any]:
    """清除 CAD 当前 pickfirst 选中，避免截图时夹点/高亮遮挡图纸。"""
    doc = _active_doc(acad)
    doc.SendCommand("(sssetfirst nil nil) ")
    return {"ok": True}
