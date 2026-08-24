"""layer.* RPC"""

from typing import Any, Dict, List, Optional

from helpers.modelspace import iter_modelspace


def _active_doc(acad):
    doc = acad.ActiveDocument
    if doc is None:
        raise RuntimeError("no active document")
    return doc


def _count_entities_per_layer(doc) -> Dict[str, int]:
    counts: Dict[str, int] = {}
    for ent in iter_modelspace(doc):
        try:
            ly = str(ent.Layer)
        except Exception:
            continue
        counts[ly] = counts.get(ly, 0) + 1
    return counts


def rpc_layer_list(acad, params) -> List[Dict[str, Any]]:
    params = params or {}
    include_count = bool(params.get("include_count", False))
    doc = _active_doc(acad)
    counts = _count_entities_per_layer(doc) if include_count else {}
    layers = doc.Layers
    out: List[Dict[str, Any]] = []
    n = int(layers.Count)
    for i in range(n):
        try:
            ly = layers.Item(i)
            name = str(ly.Name)
            on = bool(ly.LayerOn)
            frozen = bool(ly.Freeze)
            locked = bool(ly.Lock)
            color = int(ly.Color)
            row: Dict[str, Any] = {
                "name": name,
                "on": on,
                "frozen": frozen,
                "locked": locked,
                "color": color,
            }
            if include_count:
                row["entity_count"] = int(counts.get(name, 0))
            out.append(row)
        except Exception:
            continue
    return out


def rpc_layer_on(acad, params) -> Dict[str, Any]:
    params = params or {}
    names: List[str] = params.get("names") or []
    doc = _active_doc(acad)
    for nm in names:
        try:
            ly = doc.Layers.Item(nm)
            ly.LayerOn = True
        except Exception:
            continue
    return {"ok": True}


def rpc_layer_off(acad, params) -> Dict[str, Any]:
    params = params or {}
    names: List[str] = params.get("names") or []
    doc = _active_doc(acad)
    for nm in names:
        try:
            ly = doc.Layers.Item(nm)
            ly.LayerOn = False
        except Exception:
            continue
    return {"ok": True}


def rpc_layer_isolate(acad, params) -> Dict[str, Any]:
    params = params or {}
    names: List[str] = list(params.get("names") or [])
    doc = _active_doc(acad)
    layers = doc.Layers
    previous_state: Dict[str, bool] = {}
    n = int(layers.Count)
    target = set(names)
    for i in range(n):
        try:
            ly = layers.Item(i)
            lname = str(ly.Name)
            previous_state[lname] = bool(ly.LayerOn)
            if lname in target:
                ly.LayerOn = True
            else:
                ly.LayerOn = False
        except Exception:
            continue
    return {"previous_state": previous_state}


def rpc_layer_restore(acad, params) -> Dict[str, Any]:
    params = params or {}
    state = params.get("previous_state") or {}
    doc = _active_doc(acad)
    layers = doc.Layers
    if isinstance(state, dict):
        for lname, on in state.items():
            try:
                ly = doc.Layers.Item(str(lname))
                ly.LayerOn = bool(on)
            except Exception:
                continue
    return {"ok": True}


def rpc_layer_freeze(acad, params) -> Dict[str, Any]:
    params = params or {}
    names: List[str] = params.get("names") or []
    doc = _active_doc(acad)
    for nm in names:
        try:
            ly = doc.Layers.Item(nm)
            ly.Freeze = True
        except Exception:
            continue
    return {"ok": True}


def rpc_layer_thaw(acad, params) -> Dict[str, Any]:
    params = params or {}
    names: List[str] = params.get("names") or []
    doc = _active_doc(acad)
    for nm in names:
        try:
            ly = doc.Layers.Item(nm)
            ly.Freeze = False
        except Exception:
            continue
    return {"ok": True}


def rpc_layer_create(acad, params) -> Dict[str, Any]:
    params = params or {}
    name = params.get("name")
    if not name:
        raise ValueError("name required")
    doc = _active_doc(acad)
    ly = doc.Layers.Add(str(name))
    if "color" in params:
        ly.Color = int(params["color"])
    if "linetype" in params:
        ly.Linetype = str(params["linetype"])
    return {"name": str(ly.Name), "ok": True}


def rpc_layer_lock(acad, params) -> Dict[str, Any]:
    params = params or {}
    names: List[str] = params.get("names") or []
    doc = _active_doc(acad)
    for nm in names:
        try:
            ly = doc.Layers.Item(nm)
            ly.Lock = True
        except Exception:
            continue
    return {"ok": True}


def rpc_layer_unlock(acad, params) -> Dict[str, Any]:
    params = params or {}
    names: List[str] = params.get("names") or []
    doc = _active_doc(acad)
    for nm in names:
        try:
            ly = doc.Layers.Item(nm)
            ly.Lock = False
        except Exception:
            continue
    return {"ok": True}
