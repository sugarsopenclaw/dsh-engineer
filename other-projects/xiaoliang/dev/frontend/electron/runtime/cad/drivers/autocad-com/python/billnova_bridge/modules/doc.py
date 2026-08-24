"""doc.* RPC"""

import os
from typing import Any, Dict, List, Optional

from helpers.entity_cache import EntityCache
from helpers.variant import make_point, round_point


def _extents(doc) -> Dict[str, Any]:
    try:
        emin = doc.GetVariable("EXTMIN")
        emax = doc.GetVariable("EXTMAX")
        return {"min": round_point(emin), "max": round_point(emax)}
    except Exception:
        return {"min": [0.0, 0.0], "max": [0.0, 0.0]}


def _safe_doc_attr(doc, attr: str) -> str:
    try:
        value = getattr(doc, attr)
    except Exception:
        return ""
    if value is None:
        return ""
    try:
        return str(value)
    except Exception:
        return ""


def _safe_doc_name(doc) -> str:
    name = _safe_doc_attr(doc, "Name").strip()
    if name:
        return name
    path = _safe_doc_attr(doc, "FullName").strip()
    return os.path.basename(path) if path else ""


def rpc_doc_active(acad, _params) -> Dict[str, Any]:
    doc = acad.ActiveDocument
    if doc is None:
        raise RuntimeError("no active document")
    path = _safe_doc_attr(doc, "FullName")
    name = _safe_doc_name(doc)
    if not name:
        raise RuntimeError("active document name unavailable")
    saved = True
    try:
        saved = bool(doc.Saved)
    except Exception:
        pass
    return {
        "name": name,
        "path": path,
        "saved": saved,
        "extents": _extents(doc),
    }


def rpc_doc_open(acad, params) -> Dict[str, Any]:
    path = (params or {}).get("path")
    if not path:
        raise ValueError("path required")
    doc = acad.Documents.Open(path)
    EntityCache.invalidate()
    return {"name": str(doc.Name), "path": str(doc.FullName)}


def rpc_doc_send_command(acad, params) -> Dict[str, Any]:
    doc = acad.ActiveDocument
    if doc is None:
        raise RuntimeError("no active document")
    cmd = (params or {}).get("command", "")
    if not isinstance(cmd, str):
        raise ValueError("command must be string")
    if not cmd.endswith("\n"):
        cmd = cmd + "\n"
    doc.SendCommand(cmd)
    return {"ok": True}


def _serialize_sysvar_value(val: Any) -> Any:
    if val is None:
        return None
    try:
        return list(val)
    except Exception:
        pass
    if isinstance(val, (int, float, str, bool)):
        return val
    try:
        return float(val)
    except Exception:
        return str(val)


def _find_document(acad, name: Optional[str]):
    docs = acad.Documents
    if not name:
        return acad.ActiveDocument
    for i in range(int(docs.Count)):
        try:
            d = docs.Item(i)
        except Exception:
            continue
        if _safe_doc_name(d) == str(name):
            return d
    return None


def rpc_doc_list(acad, _params) -> List[Dict[str, Any]]:
    docs = acad.Documents
    out: List[Dict[str, Any]] = []
    try:
        active = acad.ActiveDocument
    except Exception:
        active = None
    active_name = _safe_doc_name(active) if active is not None else ""
    try:
        count = int(docs.Count)
    except Exception:
        count = 0
    for i in range(count):
        try:
            d = docs.Item(i)
        except Exception:
            continue
        name = _safe_doc_name(d)
        if not name:
            continue
        path = _safe_doc_attr(d, "FullName")
        out.append(
            {
                "name": name,
                "path": path,
                "active": bool(active_name) and active_name == name,
            }
        )
    return out


def rpc_doc_close(acad, params) -> Dict[str, Any]:
    params = params or {}
    name = params.get("name")
    save = bool(params.get("save", True))
    d = _find_document(acad, name)
    if d is None:
        raise RuntimeError("document not found")
    d.Close(save)
    EntityCache.invalidate()
    return {"ok": True}


def rpc_doc_switch(acad, params) -> Dict[str, Any]:
    params = params or {}
    name = params.get("name")
    if not name:
        raise ValueError("name required")
    d = _find_document(acad, str(name))
    if d is None:
        raise RuntimeError("document not found")
    d.Activate()
    EntityCache.invalidate()
    return {"ok": True}


def rpc_doc_get_variable(acad, params) -> Dict[str, Any]:
    params = params or {}
    name = params.get("name")
    if not name:
        raise ValueError("name required")
    doc = acad.ActiveDocument
    if doc is None:
        raise RuntimeError("no active document")
    val = doc.GetVariable(str(name))
    return {"value": _serialize_sysvar_value(val)}


def rpc_doc_save(acad, _params) -> Dict[str, Any]:
    doc = acad.ActiveDocument
    if doc is None:
        raise RuntimeError("no active document")
    doc.Save()
    return {"ok": True}


def rpc_doc_set_variable(acad, params) -> Dict[str, Any]:
    params = params or {}
    name = params.get("name")
    if not name:
        raise ValueError("name required")
    if "value" not in params:
        raise ValueError("value required")
    doc = acad.ActiveDocument
    if doc is None:
        raise RuntimeError("no active document")
    doc.SetVariable(str(name), params["value"])
    return {"ok": True}


def rpc_doc_purge(acad, _params) -> Dict[str, Any]:
    doc = acad.ActiveDocument
    if doc is None:
        raise RuntimeError("no active document")
    doc.SendCommand("_PURGE\nAll\n*\nNo\n")
    return {"ok": True}


def rpc_doc_new(acad, params) -> Dict[str, Any]:
    params = params or {}
    tpl = params.get("template") or ""
    doc = acad.Documents.Add(tpl)
    EntityCache.invalidate()
    return {"name": str(doc.Name), "path": str(getattr(doc, "FullName", "") or "")}


def rpc_doc_import_file(acad, params) -> Dict[str, Any]:
    params = params or {}
    path = params.get("path")
    if not path:
        raise ValueError("path required")
    doc = acad.ActiveDocument
    if doc is None:
        raise RuntimeError("no active document")
    ins = params.get("insert_point") or [0.0, 0.0]
    sc = float(params.get("scale") or 1.0)
    rot = float(params.get("rotation") or 0.0)
    pt = make_point(float(ins[0]), float(ins[1]))
    try:
        if hasattr(doc, "Import"):
            doc.Import(str(path), pt, sc)
        else:
            doc.ModelSpace.InsertBlock(pt, str(path), sc, sc, sc, rot)
    except Exception:
        doc.ModelSpace.InsertBlock(pt, str(path), sc, sc, sc, rot)
    return {"ok": True}


def rpc_doc_export_file(acad, params) -> Dict[str, Any]:
    params = params or {}
    path = params.get("path")
    ext = params.get("extension") or "dwg"
    if not path:
        raise ValueError("path required")
    doc = acad.ActiveDocument
    if doc is None:
        raise RuntimeError("no active document")
    ss = params.get("selection_set")
    try:
        doc.Export(str(path), str(ext), ss)
    except Exception:
        doc.SendCommand(f'_WBLOCK\n{path}\n\n\n\n')
    return {"ok": True}


def rpc_doc_text_styles(acad, _params) -> List[Dict[str, Any]]:
    doc = acad.ActiveDocument
    if doc is None:
        raise RuntimeError("no active document")
    ts = doc.TextStyles
    out: List[Dict[str, Any]] = []
    for i in range(int(ts.Count)):
        try:
            t = ts.Item(i)
            row: Dict[str, Any] = {"name": str(t.Name)}
            for fa in ("FontFile", "fontFile", "BigFontFile"):
                try:
                    row["font"] = str(getattr(t, fa))
                    break
                except Exception:
                    continue
            try:
                row["height"] = float(t.Height)
            except Exception:
                pass
            try:
                row["width"] = float(t.Width)
            except Exception:
                pass
            out.append(row)
        except Exception:
            continue
    return out


def rpc_doc_dim_styles(acad, _params) -> List[Dict[str, Any]]:
    doc = acad.ActiveDocument
    if doc is None:
        raise RuntimeError("no active document")
    ds = doc.DimStyles
    out: List[Dict[str, Any]] = []
    for i in range(int(ds.Count)):
        try:
            d = ds.Item(i)
            row = {"name": str(d.Name)}
            for attr in ("TextHeight", "ArrowheadSize", "DimScale", "PrimaryUnitsPrecision"):
                try:
                    row[attr.lower()] = getattr(d, attr)
                except Exception:
                    pass
            out.append(row)
        except Exception:
            continue
    return out


def rpc_doc_linetypes(acad, _params) -> List[Dict[str, Any]]:
    doc = acad.ActiveDocument
    if doc is None:
        raise RuntimeError("no active document")
    lt = doc.Linetypes
    out: List[Dict[str, Any]] = []
    for i in range(int(lt.Count)):
        try:
            l = lt.Item(i)
            desc = ""
            try:
                desc = str(l.Description)
            except Exception:
                pass
            out.append({"name": str(l.Name), "description": desc})
        except Exception:
            continue
    return out


def rpc_doc_plot_to_pdf(acad, params) -> Dict[str, Any]:
    params = params or {}
    output_path = params.get("output_path")
    if not output_path:
        raise ValueError("output_path required")
    doc = acad.ActiveDocument
    if doc is None:
        raise RuntimeError("no active document")
    layout_name = params.get("layout")
    plot = doc.Plot
    if layout_name:
        lay = doc.Layouts.Item(str(layout_name))
        doc.ActiveLayout = lay
    plot.PlotToFile(str(output_path), doc.ActiveLayout.Name)
    return {"ok": True, "path": str(output_path)}
