"""layout.* — 布局/图纸空间"""

from typing import Any, Dict, List

from entity_serializer import serialize_entity
def _active_doc(acad):
    doc = acad.ActiveDocument
    if doc is None:
        raise RuntimeError("no active document")
    return doc


def rpc_layout_list(acad, _params) -> List[Dict[str, Any]]:
    doc = _active_doc(acad)
    lays = doc.Layouts
    active = None
    try:
        active = str(doc.ActiveLayout.Name)
    except Exception:
        pass
    out: List[Dict[str, Any]] = []
    for i in range(int(lays.Count)):
        try:
            ly = lays.Item(i)
            out.append(
                {
                    "name": str(ly.Name),
                    "tab_order": int(getattr(ly, "TabOrder", i)),
                    "active": active == str(ly.Name),
                }
            )
        except Exception:
            continue
    return out


def rpc_layout_switch(acad, params) -> Dict[str, Any]:
    params = params or {}
    name = params.get("name")
    if not name:
        raise ValueError("name required")
    doc = _active_doc(acad)
    ly = doc.Layouts.Item(str(name))
    doc.ActiveLayout = ly
    return {"ok": True}


def rpc_layout_get_viewports(acad, _params) -> Dict[str, Any]:
    doc = _active_doc(acad)
    blk = doc.ActiveLayout.Block
    items: List[Dict[str, Any]] = []
    for i in range(int(blk.Count)):
        try:
            ent = blk.Item(i)
            on = str(ent.ObjectName)
            if "Viewport" not in on:
                continue
            items.append(serialize_entity(ent))
        except Exception:
            continue
    return {"viewports": items, "count": len(items)}
