"""block.* RPC"""

from typing import Any, Dict, List

from entity_serializer import serialize_entity
from helpers.modelspace import iter_modelspace


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


def rpc_block_list(acad, _params) -> List[Dict[str, Any]]:
    doc = _active_doc(acad)
    blocks = doc.Blocks
    out: List[Dict[str, Any]] = []
    n = int(blocks.Count)
    for i in range(n):
        try:
            b = blocks.Item(i)
            name = str(b.Name)
            if name.startswith("*Model_Space") or name.startswith("*Paper_Space"):
                continue
            out.append({"name": name})
        except Exception:
            continue
    return out


def rpc_block_get_references(acad, params) -> Dict[str, Any]:
    params = params or {}
    name = params.get("name")
    if not name:
        raise ValueError("name required")
    doc = _active_doc(acad)
    refs: List[Dict[str, Any]] = []
    for ent in iter_modelspace(doc):
        try:
            on = str(ent.ObjectName)
            if on != "AcDbBlockReference":
                continue
            if str(ent.Name) != str(name):
                continue
            refs.append(serialize_entity(ent))
        except Exception:
            continue
    return {"references": refs, "count": len(refs)}


def rpc_block_read_attributes(acad, params) -> Dict[str, Any]:
    params = params or {}
    handle = params.get("handle")
    if not handle:
        raise ValueError("handle required")
    doc = _active_doc(acad)
    obj = doc.HandleToObject(_normalize_handle(str(handle)))
    attrs: Dict[str, str] = {}
    try:
        ats = obj.GetAttributes()
        for i in range(int(ats.Count)):
            a = ats.Item(i)
            try:
                attrs[str(a.TagString)] = str(a.TextString)
            except Exception:
                continue
    except Exception:
        pass
    return {"attributes": attrs}


def rpc_block_get_definition(acad, params) -> Dict[str, Any]:
    params = params or {}
    name = params.get("name")
    if not name:
        raise ValueError("name required")
    doc = _active_doc(acad)
    blk = doc.Blocks.Item(str(name))
    ents: List[Dict[str, Any]] = []
    for i in range(int(blk.Count)):
        try:
            ent = blk.Item(i)
            ents.append(serialize_entity(ent))
        except Exception:
            continue
    return {"entities": ents, "count": len(ents)}


def rpc_block_explode(acad, params) -> Dict[str, Any]:
    params = params or {}
    handle = params.get("handle")
    if not handle:
        raise ValueError("handle required")
    doc = _active_doc(acad)
    obj = doc.HandleToObject(_normalize_handle(str(handle)))
    res = obj.Explode()
    out: List[Dict[str, Any]] = []
    try:
        n = int(res.Count)
    except Exception:
        try:
            n = len(res)
        except Exception:
            n = 0
    for i in range(n):
        try:
            e = res.Item(i) if hasattr(res, "Item") else res[i]
            out.append(serialize_entity(e))
        except Exception:
            continue
    return {"entities": out, "count": len(out)}
