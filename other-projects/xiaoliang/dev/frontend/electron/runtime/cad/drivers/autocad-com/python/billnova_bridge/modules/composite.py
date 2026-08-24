"""composite.* RPC — 真实组合调用（规范）"""

from typing import Any, Dict, List

from entity_serializer import representative_point, serialize_entity, stats_type_key
from helpers.modelspace import iter_modelspace
from modules import entity as entity_mod
from modules import layer as layer_mod
from modules import selection as selection_mod
from modules import view as view_mod
from modules.doc import rpc_doc_active


def _active_doc(acad):
    doc = acad.ActiveDocument
    if doc is None:
        raise RuntimeError("no active document")
    return doc


def rpc_composite_scan_drawing(acad, params) -> Dict[str, Any]:
    """可选 max_entities：仅统计前 N 个实体（用于快速冒烟/大图纸采样，不传则全量）。"""
    params = params or {}
    active = rpc_doc_active(acad, {})
    doc = _active_doc(acad)
    max_entities = params.get("max_entities")
    cap = int(max_entities) if max_entities is not None else None
    if cap is not None and cap < 0:
        cap = None

    by_type: Dict[str, int] = {}
    by_layer: Dict[str, int] = {}
    total = 0
    for ent in iter_modelspace(doc):
        try:
            ser = serialize_entity(ent)
        except Exception:
            continue
        total += 1
        tk = stats_type_key(ser)
        by_type[tk] = by_type.get(tk, 0) + 1
        ly = str(ser.get("layer", ""))
        by_layer[ly] = by_layer.get(ly, 0) + 1
        if cap is not None and total >= cap:
            break

    layers_out: List[Dict[str, Any]] = []
    layers = doc.Layers
    for i in range(int(layers.Count)):
        try:
            ly = layers.Item(i)
            name = str(ly.Name)
            layers_out.append(
                {
                    "name": name,
                    "on": bool(ly.LayerOn),
                    "frozen": bool(ly.Freeze),
                    "entity_count": int(by_layer.get(name, 0)),
                }
            )
        except Exception:
            continue

    return {
        "doc": {
            "name": active["name"],
            "path": active["path"],
            "saved": active["saved"],
        },
        "extents": active["extents"],
        "layers": layers_out,
        "entity_stats": {
            "by_type": by_type,
            "by_layer": by_layer,
            "total": total,
        },
    }


def rpc_composite_region_extract(acad, params) -> Dict[str, Any]:
    params = params or {}
    mn = params.get("min")
    mx = params.get("max")
    if not mn or not mx:
        raise ValueError("min and max required")
    layers = params.get("layers")
    types = params.get("types")
    view_mod.rpc_view_zoom_window(acad, {"min": mn, "max": mx})
    win = entity_mod.rpc_entity_read_by_window(
        acad, {"min": mn, "max": mx, "layers": layers, "types": types}
    )
    # read_by_window 已限定窗口内实体；read_all_text(region) / read_all_dims(region) 等价于类型过滤
    texts_filtered = [e for e in win["entities"] if e.get("type") in ("text", "mtext")]
    dims_filtered = [e for e in win["entities"] if e.get("type") == "dimension"]
    shot = view_mod.rpc_view_screenshot(
        acad,
        {"width": params.get("width"), "height": params.get("height")},
    )
    doc = _active_doc(acad)
    doc.SendCommand("ZOOM P\n")
    return {
        "entities": win["entities"],
        "count": win["count"],
        "texts": texts_filtered,
        "dimensions": dims_filtered,
        "screenshot": shot,
    }


def rpc_composite_batch_read(acad, params) -> Dict[str, Any]:
    params = params or {}
    handles: List[Any] = params.get("handles") or []
    include_nearby = bool(params.get("include_nearby"))
    items: List[Dict[str, Any]] = []
    errors: List[Dict[str, Any]] = []
    for h in handles:
        hs = str(h)
        try:
            ent = entity_mod.rpc_entity_read_by_handle(acad, {"handle": hs})["entity"]
            row: Dict[str, Any] = {"handle": hs, "entity": ent}
            if include_nearby:
                rp = representative_point(ent)
                if rp:
                    row["nearby"] = selection_mod.rpc_selection_nearest(
                        acad,
                        {"point": [rp[0], rp[1]], "count": 5},
                    )
                else:
                    row["nearby"] = {"entities": [], "count": 0}
            items.append(row)
        except Exception as e:
            errors.append({"handle": hs, "error": str(e)})
    return {"items": items, "errors": errors}


def rpc_composite_layer_isolate_extract(acad, params) -> Dict[str, Any]:
    params = params or {}
    isolate_names = params.get("layers") or []
    region = params.get("region") or {}
    prev = layer_mod.rpc_layer_isolate(acad, {"names": isolate_names}).get("previous_state") or {}
    try:
        if region.get("min") and region.get("max"):
            ex = rpc_composite_region_extract(
                acad,
                {
                    "min": region["min"],
                    "max": region["max"],
                    "layers": params.get("entity_layers"),
                    "types": params.get("types"),
                    "width": params.get("width"),
                    "height": params.get("height"),
                },
            )
        else:
            ex = {"ok": True, "note": "no region; only isolated layers"}
        return {"isolate_previous_state": prev, "extract": ex}
    finally:
        layer_mod.rpc_layer_restore(acad, {"previous_state": prev})
